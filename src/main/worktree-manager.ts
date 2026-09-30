import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { git, FETCH_TIMEOUT_MS, isGitRepo, renameBranch as gitRenameBranch, branchHasRemote, validateBranchName, branchExists, getDefaultBranch, currentBranch, localBranchExists, remoteTrackingRef, isWorkingTreeClean, worktreeBranches, checkoutBranch } from './git.js';
import { logger } from './logger.js';
import { removeDirectory, removeDirectoryWithRetry, pathExists, readFileWithRetry, writeFileAtomic } from './fs-utils.js';
import type { BranchSwitchResult, BranchSyncResult, WorktreeConfig, WorktreeInfo, WorktreeRepoConfig } from '../shared/types.js';
import { adapterRegistry } from './adapters/index.js';
import type { AutoNameDecision, DisplayNameSource, DisplayNameState } from './session-auto-name.js';

const CONFIG_FILE = 'config.json';
const MANIFEST_FILE = 'manifest.json';
const NPM_CACHE_DIR = '.npm-cache';
/** Where the sweep moves worktree folders it can't account for. */
const TRASH_DIR = '.trash';
/** How long a folder stays in the trash before it is deleted. */
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_COPY_PATTERNS = ['.env', '.env.local', '.env.development', '.npmrc', '.nvmrc'];

/** Entries written before the agent was recorded all ran Claude Code. */
const LEGACY_AGENT_TYPE = 'claude-code';

function agentTypeOf(entry: ManifestEntry): string {
  return entry.adapterType ?? LEGACY_AGENT_TYPE;
}

interface ManifestEntry {
  repoPath: string;
  branch: string;
  createdAt: number;
  lastActiveAt?: number;
  providerSessionId?: string;
  /** @deprecated Use providerSessionId — kept for migration from older manifests. */
  claudeSessionId?: string;
  /** Last model the session ran with, so it can be restored after app restart. */
  model?: string;
  /** Adapter id of the agent the session runs. Absent on entries written
   *  before this was recorded, which were all Claude Code. */
  adapterType?: string;
  direct?: boolean;
  /** Explicit checkout path for sessions that share another session's worktree
   *  (attached sessions). Absent for normal direct (repoPath) and worktree
   *  (worktreeRoot/hash/id) sessions, whose paths are derived. */
  path?: string;
  /** User-assigned or auto-generated display name, persisted across restart. */
  displayName?: string;
  /** Who set displayName. Auto-naming never replaces a 'user' name. Absent
   *  on entries saved before this was tracked (see decideAutoName). */
  displayNameSource?: DisplayNameSource;
  /** Epoch ms when the user marked the session completed; absent while open. */
  completedAt?: number;
  /** The session was destroyed but its directory could not be deleted (Windows
   *  file locks). The entry is hidden from listings and the background sweep
   *  retries the deletion as a known item instead of finding an orphan dir. */
  pendingRemoval?: boolean;
  /** Whether the deferred removal should also delete the branch. */
  pendingBranchDelete?: boolean;
  /** Branches Grove created for this conversation: its own branch, and any
   *  created from the branch picker. Only these may be force-deleted on
   *  removal; a branch the conversation merely switched onto may hold work
   *  that exists nowhere else. Absent on entries written before this was
   *  recorded, which get the safe delete only. */
  createdBranches?: string[];
}

type Manifest = Record<string, ManifestEntry>;

/** A path in comparable form: separators normalised and, on Windows, case
 *  folded. git prints worktree paths with forward slashes, and may not use
 *  the same letter case as the path Grove gave it. */
function pathKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  /** Ids whose worktree directory is being created: on disk before it is in
   *  the manifest or in `worktrees`, so the sweep must leave it alone. */
  private creating = new Set<string>();
  private manifestLock = Promise.resolve();
  /** Per-repo locks to serialize git worktree operations (e.g. concurrent removes). */
  private repoLocks = new Map<string, Promise<void>>();

  /** Serialize operations on the same repo to prevent concurrent git conflicts. */
  private async withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.repoLocks.get(repoPath) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.repoLocks.set(repoPath, next);
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
      // Clean up lock entry when queue is drained
      if (this.repoLocks.get(repoPath) === next) {
        this.repoLocks.delete(repoPath);
      }
    }
  }

  /** Serialize manifest reads/writes to prevent concurrent clobber. */
  private async withManifest<T>(fn: (manifest: Manifest) => T | Promise<T>): Promise<T> {
    const prev = this.manifestLock;
    let resolve!: () => void;
    this.manifestLock = new Promise((r) => { resolve = r; });
    await prev;
    try {
      const manifest = await this.loadManifest();
      const result = await fn(manifest);
      await this.saveManifest(manifest);
      return result;
    } finally {
      resolve();
    }
  }

  private getWorktreeRoot(): string {
    return path.join(app.getPath('userData'), 'worktrees');
  }

  private repoHash(repoPath: string): string {
    return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 8);
  }

  /**
   * Read the manifest. Only a missing file reads as empty: an unreadable or
   * corrupt one throws. Treating those as empty used to be destructive: the
   * next write saved the empty manifest over every entry, and the sweep then
   * deleted each worktree directory it no longer found listed.
   */
  private async loadManifest(): Promise<Manifest> {
    const manifestPath = path.join(this.getWorktreeRoot(), MANIFEST_FILE);
    let data: string;
    try {
      data = await readFileWithRetry(manifestPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error(`Could not read the worktree manifest ${manifestPath}: ${(e as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      throw new Error(`The worktree manifest ${manifestPath} is corrupt: ${(e as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`The worktree manifest ${manifestPath} is corrupt: not an object`);
    }
    return parsed as Manifest;
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    const root = this.getWorktreeRoot();
    await fs.mkdir(root, { recursive: true });
    await writeFileAtomic(path.join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  }

  async validateRepo(repoPath: string): Promise<boolean> {
    return isGitRepo(repoPath);
  }

  async create(config: WorktreeConfig): Promise<WorktreeInfo> {
    const { repoPath, branchName, baseBranch, useExisting } = config;

    const id = config.id ?? crypto.randomUUID().slice(0, 8);
    const hash = this.repoHash(repoPath);
    const wtPath = path.join(this.getWorktreeRoot(), hash, id);

    this.creating.add(id);
    try {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(wtPath), { recursive: true });

      // Create worktree: existing branch or new branch. A new branch whose
      // name is taken fails here: git refuses, and nothing is deleted to make
      // room (the name may belong to another conversation's worktree).
      if (useExisting) {
        await git(['worktree', 'add', wtPath, branchName], repoPath);
      } else {
        // Pull the latest base branch so the new agent starts from what's on origin
        const startPoint = baseBranch ? await this.pullBaseBranch(repoPath, baseBranch) : undefined;
        await git(['worktree', 'add', '-b', branchName, wtPath, ...(startPoint ? [startPoint] : [])], repoPath);
      }

      // Generate agent-specific settings (e.g. .claude/settings.local.json)
      await this.generateAdapterSettings(wtPath, repoPath, config.adapterType);

      const info: WorktreeInfo = {
        id,
        path: wtPath,
        branch: branchName,
        repoPath,
        createdAt: Date.now(),
      };

      this.worktrees.set(id, info);

      // Write entry to manifest
      await this.withManifest((manifest) => {
        manifest[id] = {
          repoPath,
          branch: branchName,
          createdAt: info.createdAt,
          ...(useExisting ? {} : { createdBranches: [branchName] }),
        };
      });

      return info;
    } finally {
      this.creating.delete(id);
    }
  }

  /**
   * Bring `base` up to date with `origin/<base>` and return the ref the new
   * worktree should branch from.
   *
   * Fetches origin, then fast-forwards the local branch: via `merge --ff-only`
   * when it is checked out in the main repo, via `branch -f` when it is not
   * checked out anywhere. When the local branch cannot be moved (dirty
   * checkout, checked out in another agent's worktree) the freshly fetched
   * remote commit is returned instead, so the agent still gets the latest
   * changes. Offline, missing remote, or a diverged local branch fall back to
   * the local ref — this never blocks session creation.
   */
  private async pullBaseBranch(repoPath: string, base: string): Promise<string> {
    if (!(await branchHasRemote(repoPath, base))) return base;

    const remote = `origin/${base}`;
    try {
      await git(['fetch', 'origin', base], repoPath, { timeout: FETCH_TIMEOUT_MS });
    } catch (e) {
      logger.warn(`Could not fetch ${remote}; starting from local ${base}`, e);
      return base;
    }

    // Local already has everything upstream has (equal or ahead) — nothing to do
    if (await this.isAncestor(repoPath, remote, base)) return base;

    // Local has commits origin doesn't: can't fast-forward, and branching from
    // origin would silently drop them — keep the user's ref and say so.
    if (!(await this.isAncestor(repoPath, base, remote))) {
      logger.warn(`${base} has diverged from ${remote}; starting from local ${base}`);
      return base;
    }

    // Local is strictly behind. Fast-forward it if we safely can.
    const headBranch = await git(['symbolic-ref', '--short', '-q', 'HEAD'], repoPath)
      .then((s) => s.trim())
      .catch(() => '');
    let updated = false;
    if (headBranch === base) {
      try {
        await git(['merge', '--ff-only', remote], repoPath);
        updated = true;
      } catch (e) {
        logger.warn(`Could not fast-forward checked-out ${base} (uncommitted changes?)`, e);
      }
    } else if (!(await this.isCheckedOutInWorktree(repoPath, base))) {
      try {
        await git(['branch', '-f', base, remote], repoPath);
        updated = true;
      } catch (e) {
        logger.warn(`Could not fast-forward ${base}`, e);
      }
    } else {
      logger.info(`${base} is checked out in another worktree; not touching it`);
    }
    if (updated) {
      logger.info(`Fast-forwarded ${base} to ${remote}`);
      return base;
    }

    // Couldn't move the local ref: branch from the remote commit directly.
    // Use the SHA rather than the ref name so the new branch doesn't get
    // origin/<base> configured as its upstream.
    const sha = (await git(['rev-parse', '--verify', `${remote}^{commit}`], repoPath)).trim();
    logger.info(`Starting from ${remote} (${sha.slice(0, 8)}) instead of stale local ${base}`);
    return sha;
  }

  private async isAncestor(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
    try {
      await git(['merge-base', '--is-ancestor', ancestor, descendant], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /** True when `branch` is checked out in any worktree of the repo (main checkout included). */
  private async isCheckedOutInWorktree(repoPath: string, branch: string): Promise<boolean> {
    try {
      const list = await git(['worktree', 'list', '--porcelain'], repoPath);
      return list.split('\n').some((line) => line.trim() === `branch refs/heads/${branch}`);
    } catch {
      return false;
    }
  }

  /**
   * Register a "direct" session — runs in-place on an existing checkout, no new
   * worktree created. Defaults to the repo checkout; pass `checkoutPath` to
   * attach the session to another session's worktree (sharing its branch).
   * Still tracked in the manifest for session ID persistence.
   */
  async registerDirect(repoPath: string, branch: string, checkoutPath: string = repoPath): Promise<WorktreeInfo> {
    const id = crypto.randomUUID().slice(0, 8);
    const attached = checkoutPath !== repoPath;

    const info: WorktreeInfo = {
      id,
      path: checkoutPath,
      branch,
      repoPath,
      createdAt: Date.now(),
      direct: true,
    };

    this.worktrees.set(id, info);

    await this.withManifest((manifest) => {
      manifest[id] = {
        repoPath,
        branch,
        createdAt: info.createdAt,
        direct: true,
        // Persist the path only for attached sessions; plain direct sessions
        // derive it from repoPath, so storing it would be redundant.
        ...(attached ? { path: checkoutPath } : {}),
      };
    });

    return info;
  }

  /** Persist the provider session ID so it can be resumed after restart. */
  async saveProviderSessionId(worktreeId: string, sessionId: string): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].providerSessionId = sessionId;
      }
    });
  }

  /** Update the last-active timestamp for a worktree (persisted to manifest). */
  async updateLastActive(worktreeId: string): Promise<void> {
    const now = Date.now();
    const info = this.worktrees.get(worktreeId);
    if (info) info.lastActiveAt = now;
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].lastActiveAt = now;
      }
    });
  }

  /** Retrieve the last provider session ID for a worktree. */
  async getProviderSessionId(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    const entry = manifest[worktreeId];
    // Fall back to old claudeSessionId field for migration
    return entry?.providerSessionId ?? entry?.claudeSessionId;
  }

  /** Persist the model a session is running with so it survives app restart. */
  async saveModel(worktreeId: string, model: string): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].model = model;
      }
    });
  }

  /** Retrieve the last model recorded for a worktree. */
  async getModel(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    return manifest[worktreeId]?.model;
  }

  /** Record which agent a session runs, so a restart resumes it on the same
   *  agent and background tasks for it use that agent. */
  async saveAdapterType(worktreeId: string, adapterType: string): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].adapterType = adapterType;
      }
    });
  }

  /** The agent a session runs, or undefined for an unknown session. */
  async getAdapterType(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    const entry = manifest[worktreeId];
    return entry ? agentTypeOf(entry) : undefined;
  }

  /** Persist a name the user gave a session so it survives app restart and
   *  is never replaced by auto-naming. Passing an empty name clears it
   *  (reverting the label back to the branch name). */
  async saveDisplayName(worktreeId: string, displayName: string): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].displayName = displayName || undefined;
        manifest[worktreeId].displayNameSource = 'user';
      }
    });
  }

  /** A session's persisted name and who set it (undefined for unknown ids). */
  async getDisplayNameState(worktreeId: string): Promise<DisplayNameState | undefined> {
    const entry = (await this.loadManifest())[worktreeId];
    if (!entry || entry.pendingRemoval) return undefined;
    return { displayName: entry.displayName ?? null, source: entry.displayNameSource };
  }

  /** Save an auto-naming decision only if the name is still what it was when
   *  `expected` was read, so a rename made in the meantime is never
   *  overwritten. Returns whether it was saved. */
  async saveAutoDisplayName(worktreeId: string, expected: DisplayNameState, next: AutoNameDecision): Promise<boolean> {
    return this.withManifest((manifest) => {
      const entry = manifest[worktreeId];
      if (!entry || (entry.displayName ?? null) !== expected.displayName || entry.displayNameSource !== expected.source) {
        return false;
      }
      entry.displayName = next.displayName;
      entry.displayNameSource = next.source;
      return true;
    });
  }

  /** Persist whether the user marked a session completed. Reopening clears
   *  the timestamp rather than keeping a stale one. */
  async saveCompleted(worktreeId: string, completed: boolean, now = Date.now()): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].completedAt = completed ? now : undefined;
      }
    });
    const info = this.worktrees.get(worktreeId);
    if (info) info.completedAt = completed ? now : null;
  }


  /**
   * Throw when removing `id` would take its worktree from other conversations
   * (ones started on it with New Conversation, which run in it without owning
   * it). Removal runs `git worktree remove --force` and can delete the branch,
   * so they'd lose their checkout and commits. Callers check before tearing
   * anything down; remove() checks again.
   */
  async assertRemovable(id: string): Promise<void> {
    const info = this.worktrees.get(id) ?? await this.getWorktreeOrManifest(id).catch(() => undefined);
    if (!info || info.direct) return;
    const others = (await this.sharersOfPath(id, info.path)).filter((other) => other !== id);
    if (others.length === 0) return;
    throw new Error(
      `${others.length === 1 ? 'Another conversation is' : `${others.length} other conversations are`} still working in this conversation's worktree. `
      + 'Delete them first; deleting this one would remove their checkout too.',
    );
  }

  async remove(id: string, deleteBranch = false): Promise<void> {
    await this.assertRemovable(id);
    let info = this.worktrees.get(id);
    const createdBranches = deleteBranch ? (await this.loadManifest())[id]?.createdBranches : undefined;

    // Fall back to manifest if not in memory (e.g. after restart)
    if (!info) {
      const manifest = await this.loadManifest();
      const entry = manifest[id];
      if (!entry) return;
      const hash = this.repoHash(entry.repoPath);
      info = {
        id,
        path: entry.path ?? (entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), hash, id)),
        branch: entry.branch,
        repoPath: entry.repoPath,
        createdAt: entry.createdAt,
        lastActiveAt: entry.lastActiveAt,
        direct: entry.direct,
      };
    }

    const { path: wtPath, repoPath, branch } = info;

    // Serialize git operations per-repo to prevent concurrent worktree remove conflicts
    await this.withRepoLock(repoPath, async () => {
      let dirRemoved = true;
      if (!info.direct) {
        // Retry chain for Windows file locking
        try {
          await git(['worktree', 'remove', wtPath], repoPath);
        } catch {
          try {
            await git(['worktree', 'remove', '--force', wtPath], repoPath);
          } catch {
            try {
              // A PTY shell or agent process may still be releasing its cwd;
              // back off briefly before giving up.
              await removeDirectoryWithRetry(wtPath);
              await git(['worktree', 'prune'], repoPath);
            } catch (e) {
              dirRemoved = false;
              logger.warn(`Worktree ${id} is still locked; deferring removal to the background sweep: ${e}`);
            }
          }
        }
      }

      this.worktrees.delete(id);

      if (!dirRemoved) {
        // Keep the manifest entry (hidden) so the sweep retries this as a
        // known item rather than discovering an untracked directory later.
        await this.withManifest((manifest) => {
          const entry = manifest[id];
          if (entry) {
            entry.pendingRemoval = true;
            entry.pendingBranchDelete = deleteBranch;
          }
        });
        return;
      }

      // Optionally delete branch (skip for direct sessions — it's the checked-out branch)
      if (deleteBranch && !info.direct) {
        await this.deleteConversationBranches(repoPath, wtPath, branch, createdBranches);
      }

      // Remove entry from manifest
      await this.withManifest((manifest) => {
        delete manifest[id];
      });

      // Clean up empty repoHash directory (skip for direct — no worktree dir was created)
      if (!info.direct) {
        const hash = this.repoHash(repoPath);
        const repoDir = path.join(this.getWorktreeRoot(), hash);
        try {
          const entries = await fs.readdir(repoDir);
          const remaining = entries.filter((e) => e !== CONFIG_FILE && e !== NPM_CACHE_DIR);
          if (remaining.length === 0) {
            await fs.rm(repoDir, { recursive: true, force: true });
          }
        } catch { /* directory may not exist */ }
      }
    });
  }

  /**
   * Delete a removed conversation's branches: the one it is on (what the
   * destroy dialog names) and any others Grove created for it. Only branches
   * Grove created are force-deleted; the rest get `git branch -d`, which
   * refuses to drop unmerged work. Branches checked out elsewhere are kept.
   */
  private async deleteConversationBranches(repoPath: string, removedPath: string, current: string, created: string[] | undefined): Promise<void> {
    const createdSet = new Set(created ?? []);
    let inUse = new Map<string, string>();
    try {
      inUse = await worktreeBranches(repoPath);
    } catch { /* git refuses to delete a checked-out branch anyway */ }
    for (const branch of new Set([current, ...createdSet])) {
      const usedBy = inUse.get(branch);
      if (usedBy && !samePath(usedBy, removedPath)) {
        logger.info(`Keeping branch ${branch}: it is checked out in ${usedBy}`);
        continue;
      }
      // Grove's own branches the user asked to delete go even if unmerged;
      // a created branch the conversation later left only goes if merged.
      await this.deleteBranchQuietly(repoPath, branch, branch === current && createdSet.has(branch));
    }
  }

  private async deleteBranchQuietly(repoPath: string, branch: string, force: boolean): Promise<void> {
    // A conversation can switch onto the default branch; closing it must not
    // take that branch with it.
    if (branch === (await getDefaultBranch(repoPath).catch(() => null))) {
      logger.info(`Keeping branch ${branch}: it is the repository's default branch`);
      return;
    }
    try {
      await git(['branch', '-d', branch], repoPath);
    } catch (e) {
      if (!force) {
        logger.info(`Keeping branch ${branch}: it has unmerged work and Grove didn't create it (${e})`);
        return;
      }
      try {
        await git(['branch', '-D', branch], repoPath);
      } catch (e2) {
        logger.warn(`Failed to delete branch ${branch}: ${e2}`);
      }
    }
  }

  /**
   * Retry removal of worktrees whose directories were locked when the session
   * was destroyed. Returns the number of entries fully cleaned up.
   */
  async processPendingRemovals(): Promise<number> {
    const manifest = await this.loadManifest();
    const pending = Object.entries(manifest).filter(([, e]) => e.pendingRemoval);
    if (pending.length === 0) return 0;

    let cleaned = 0;
    for (const [id, entry] of pending) {
      const hash = this.repoHash(entry.repoPath);
      const wtPath = entry.path ?? path.join(this.getWorktreeRoot(), hash, id);
      try {
        await this.withRepoLock(entry.repoPath, async () => {
          if (!entry.direct && (await pathExists(wtPath))) {
            await removeDirectory(wtPath);
          }
          try { await git(['worktree', 'prune'], entry.repoPath); } catch { /* repo may be gone */ }
          if (entry.pendingBranchDelete && !entry.direct) {
            await this.deleteConversationBranches(entry.repoPath, wtPath, entry.branch, entry.createdBranches);
          }
        });
        await this.withManifest((m) => { delete m[id]; });
        cleaned++;
        logger.info(`Sweep: completed deferred removal of worktree ${id}`);
      } catch (e) {
        logger.warn(`Sweep: worktree ${id} still locked, will retry next sweep: ${e}`);
      }
    }
    return cleaned;
  }

  async list(repoPath: string): Promise<WorktreeInfo[]> {
    try {
      const manifest = await this.loadManifest();
      const output = await git(['worktree', 'list', '--porcelain'], repoPath);
      const blocks = output.split('\n\n').filter(Boolean);

      // Collect all worktree paths git knows about (normalized for cross-platform comparison)
      const gitWorktrees = new Map<string, string>(); // normalized path → raw block
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtPathLine = lines.find((l) => l.startsWith('worktree '));
        if (wtPathLine) {
          const raw = wtPathLine.replace('worktree ', '');
          gitWorktrees.set(pathKey(raw), block);
        }
      }

      const hash = this.repoHash(repoPath);
      const entries: WorktreeInfo[] = [];

      // Return manifest entries for this repo that git still knows about
      for (const [id, entry] of Object.entries(manifest)) {
        if (entry.repoPath !== repoPath) continue;
        if (entry.pendingRemoval) continue;

        // Direct sessions don't create their own worktree on disk. Plain ones
        // run on the repo checkout; attached ones carry an explicit path to the
        // worktree they share.
        if (entry.direct) {
          entries.push({
            id,
            path: entry.path ?? repoPath,
            branch: entry.branch,
            repoPath,
            createdAt: entry.createdAt,
            lastActiveAt: entry.lastActiveAt,
            direct: true,
            displayName: entry.displayName ?? null,
            completedAt: entry.completedAt ?? null,
            agentType: agentTypeOf(entry),
          });
          continue;
        }

        const wtPath = path.join(this.getWorktreeRoot(), hash, id);
        const block = gitWorktrees.get(pathKey(wtPath));
        if (!block) continue;

        // Get branch from git porcelain output for accuracy
        let branch = entry.branch;
        const branchLine = block.split('\n').find((l) => l.startsWith('branch '));
        if (branchLine) {
          branch = branchLine.replace('branch refs/heads/', '');
        }

        entries.push({
          id,
          path: wtPath,
          branch,
          repoPath,
          createdAt: entry.createdAt,
          lastActiveAt: entry.lastActiveAt,
          displayName: entry.displayName ?? null,
          completedAt: entry.completedAt ?? null,
          agentType: agentTypeOf(entry),
        });
      }

      return entries;
    } catch {
      return [];
    }
  }

  /** Return all unique repo paths recorded in the manifest. */
  async listRepos(): Promise<string[]> {
    const manifest = await this.loadManifest();
    const repos = new Set<string>();
    for (const entry of Object.values(manifest)) {
      if (entry.pendingRemoval) continue;
      repos.add(entry.repoPath);
    }
    return [...repos];
  }

  async copyUntrackedFiles(worktreeId: string, files: string[]): Promise<void> {
    const info = this.worktrees.get(worktreeId);
    if (!info) return;

    for (const file of files) {
      const src = path.join(info.repoPath, file);
      const dest = path.join(info.path, file);
      try {
        await fs.access(src);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      } catch {
        // Source doesn't exist, skip
      }
    }
  }

  async renameBranch(id: string, newName: string): Promise<string> {
    const info = this.worktrees.get(id);
    if (!info) {
      // Fall back to manifest
      const manifest = await this.loadManifest();
      const entry = manifest[id];
      if (!entry) throw new Error(`Worktree ${id} not found`);
      throw new Error(`Conversation ${id} is not active`);
    }

    if (info.direct) {
      throw new Error('Cannot rename branch for direct conversations');
    }

    const oldName = info.branch;
    if (oldName === newName) return newName;

    // Validate new name
    const valid = await validateBranchName(newName);
    if (!valid) throw new Error(`Invalid branch name: "${newName}"`);

    // Check new name doesn't already exist
    const exists = await branchExists(info.repoPath, newName);
    if (exists) throw new Error(`Branch "${newName}" already exists`);

    // Check branch hasn't been pushed
    const hasRemote = await branchHasRemote(info.repoPath, oldName);
    if (hasRemote) throw new Error(`Branch "${oldName}" has been pushed to a remote and cannot be renamed`);

    // Rename via git (run in the worktree so it renames the checked-out branch)
    await gitRenameBranch(info.path, oldName, newName);

    // Update in-memory
    info.branch = newName;

    // Update manifest
    await this.withManifest((manifest) => {
      const entry = manifest[id];
      if (entry) {
        entry.branch = newName;
        if (entry.createdBranches) {
          entry.createdBranches = entry.createdBranches.map((b) => (b === oldName ? newName : b));
        }
      }
    });

    return newName;
  }

  /** Ids of every conversation on `id`'s checkout: itself, direct
   *  conversations on the same project folder, and conversations attached
   *  to the same worktree. Includes ones not loaded this run. */
  async checkoutSharers(id: string): Promise<string[]> {
    const info = this.worktrees.get(id);
    if (!info) return [];
    return this.sharersOfPath(id, info.path);
  }

  /** `id` plus every conversation, loaded or not, whose checkout is `checkoutPath`. */
  private async sharersOfPath(id: string, checkoutPath: string): Promise<string[]> {
    const ids = new Set<string>([id]);
    for (const w of this.worktrees.values()) {
      if (samePath(w.path, checkoutPath)) ids.add(w.id);
    }
    const manifest = await this.loadManifest();
    for (const [otherId, entry] of Object.entries(manifest)) {
      if (entry.pendingRemoval) continue;
      const entryPath = entry.path ?? (entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), this.repoHash(entry.repoPath), otherId));
      if (samePath(entryPath, checkoutPath)) ids.add(otherId);
    }
    return [...ids];
  }

  /**
   * Check out another branch in a conversation's checkout: an existing local
   * branch, a remote-only branch (a local tracking branch is created), or
   * with `create` a new branch at HEAD. Every conversation sharing the
   * checkout moves with it, so all their recorded branches are updated.
   *
   * Refused when a conversation sharing the checkout is mid-turn
   * (`busySessionIds`, which only the renderer knows), when the tree has
   * uncommitted changes, or when the branch is checked out in another
   * worktree. A new branch at HEAD skips the dirty check: no file changes,
   * so the uncommitted work just comes along.
   */
  async switchBranch(
    id: string,
    branch: string,
    opts: { create?: boolean; busySessionIds?: string[] } = {},
  ): Promise<BranchSwitchResult> {
    const info = this.worktrees.get(id);
    if (!info) return { success: false, error: 'This conversation is not active.' };
    const name = branch.trim();
    if (!name || name.startsWith('-') || !(await validateBranchName(name))) {
      return { success: false, error: `"${name}" is not a valid branch name.` };
    }
    const create = opts.create === true;
    const cwd = info.path;

    return this.withRepoLock(info.repoPath, async (): Promise<BranchSwitchResult> => {
      const sharers = await this.checkoutSharers(id);
      const busy = new Set(opts.busySessionIds ?? []);
      if (sharers.some((s) => busy.has(s))) {
        return { success: false, error: 'An agent is working in this checkout. Wait for its turn to finish, then switch.' };
      }

      try {
        // Already there (e.g. the agent switched in its own shell): nothing to
        // check out, just bring the recorded branch in line.
        if ((await currentBranch(cwd)) !== name) {
          const isLocal = await localBranchExists(cwd, name);
          let track: string | undefined;
          if (create) {
            if (isLocal) return { success: false, error: `A branch named "${name}" already exists.` };
          } else if (!isLocal) {
            track = (await remoteTrackingRef(cwd, name)) ?? undefined;
            if (!track) return { success: false, error: `Branch "${name}" doesn't exist.` };
          }

          // Untracked files don't block a checkout unless it would overwrite
          // them, and git refuses that case itself (reported below). Counting
          // them blocked every switch: Grove writes an untracked
          // .claude/settings.local.json into each worktree.
          if (!create && !(await isWorkingTreeClean(cwd, { ignoreUntracked: true }))) {
            return { success: false, error: 'This checkout has uncommitted changes. Commit or stash them first.' };
          }

          if (isLocal) {
            const usedBy = (await worktreeBranches(info.repoPath)).get(name);
            if (usedBy && !samePath(usedBy, cwd)) {
              return { success: false, error: `"${name}" is already checked out in ${usedBy}. A branch can only be checked out in one place.` };
            }
          }

          await checkoutBranch(cwd, name, { create, track });
        }
      } catch (e: any) {
        return { success: false, error: (e?.stderr || e?.message || String(e)).trim().slice(0, 500) };
      }

      await this.recordBranch(sharers, name, { created: create });
      return { success: true, branch: name, sessionIds: sharers };
    });
  }

  /**
   * Bring the recorded branch in line with the branch the checkout is on now.
   * The agent (or the user, in a terminal) can run `git checkout` itself,
   * which the app never sees. Every conversation sharing the checkout is
   * updated. Returns null when nothing moved: same branch, detached HEAD
   * (mid-rebase, or a commit checked out), or the conversation is not active.
   */
  async syncBranch(id: string): Promise<BranchSyncResult | null> {
    const info = this.worktrees.get(id);
    if (!info) return null;
    // Cheap check outside the lock: nearly every call finds nothing to do.
    const seen = await currentBranch(info.path);
    if (!seen || seen === info.branch) return null;

    return this.withRepoLock(info.repoPath, async () => {
      // Re-read under the lock: a switch or removal may have run meanwhile.
      if (this.worktrees.get(id) !== info) return null;
      const name = await currentBranch(info.path);
      if (!name || name === info.branch) return null;
      const sharers = await this.checkoutSharers(id);
      await this.recordBranch(sharers, name);
      return { branch: name, sessionIds: sharers };
    });
  }

  /** Record `name` as the branch of every conversation in `ids`, in memory
   *  and in the manifest. `created` marks a branch Grove just made, which
   *  removal may force-delete (see createdBranches). A switch the agent made
   *  in its own shell never counts: it may have checked out someone's branch. */
  private async recordBranch(ids: string[], name: string, opts: { created?: boolean } = {}): Promise<void> {
    const idSet = new Set(ids);
    for (const w of this.worktrees.values()) {
      if (idSet.has(w.id)) w.branch = name;
    }
    await this.withManifest((manifest) => {
      for (const s of ids) {
        const entry = manifest[s];
        if (!entry) continue;
        entry.branch = name;
        if (opts.created && entry.createdBranches && !entry.createdBranches.includes(name)) {
          entry.createdBranches = [...entry.createdBranches, name];
        }
      }
    });
  }

  getWorktree(id: string): WorktreeInfo | undefined {
    return this.worktrees.get(id);
  }

  /** Look up a worktree by ID, falling back to the manifest if not in memory. */
  async getWorktreeOrManifest(id: string): Promise<WorktreeInfo | undefined> {
    const mem = this.worktrees.get(id);
    if (mem) return mem;

    const manifest = await this.loadManifest();
    const entry = manifest[id];
    if (!entry || entry.pendingRemoval) return undefined;

    const hash = this.repoHash(entry.repoPath);
    const info: WorktreeInfo = {
      id,
      path: entry.path ?? (entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), hash, id)),
      branch: entry.branch,
      repoPath: entry.repoPath,
      createdAt: entry.createdAt,
      lastActiveAt: entry.lastActiveAt,
      direct: entry.direct,
      displayName: entry.displayName ?? null,
      completedAt: entry.completedAt ?? null,
      agentType: agentTypeOf(entry),
    };

    // Cache in memory for subsequent lookups
    this.worktrees.set(id, info);
    return info;
  }

  /** Register a worktree discovered on disk (e.g. surviving a restart) into the internal map so it can be destroyed later. */
  register(info: WorktreeInfo): void {
    if (!this.worktrees.has(info.id)) {
      this.worktrees.set(info.id, info);
    }
  }

  /**
   * Move a worktree folder the app can't account for into the trash instead
   * of deleting it. Such a folder may still hold uncommitted work: a lost or
   * deleted manifest makes every folder look unknown. purgeTrash() deletes
   * it once TRASH_RETENTION_MS has passed. Throws when the folder is locked,
   * like a deletion would, so the sweep retries next time.
   */
  private async moveToTrash(dirPath: string, now = Date.now()): Promise<string> {
    const trash = path.join(this.getWorktreeRoot(), TRASH_DIR);
    await fs.mkdir(trash, { recursive: true });
    const dest = path.join(trash, `${now}-${path.basename(path.dirname(dirPath))}-${path.basename(dirPath)}`);
    await fs.rename(dirPath, dest);
    logger.warn(`Moved unaccounted-for worktree folder ${dirPath} to ${dest}; it will be deleted after ${TRASH_RETENTION_MS / 86_400_000} days`);
    return dest;
  }

  /** Delete trashed folders older than TRASH_RETENTION_MS. Returns how many. */
  async purgeTrash(now = Date.now()): Promise<number> {
    const trash = path.join(this.getWorktreeRoot(), TRASH_DIR);
    let names: string[];
    try {
      names = await fs.readdir(trash);
    } catch {
      return 0;
    }
    let purged = 0;
    for (const name of names) {
      const movedAt = Number(name.split('-')[0]);
      if (!Number.isFinite(movedAt) || now - movedAt < TRASH_RETENTION_MS) continue;
      try {
        await removeDirectory(path.join(trash, name));
        purged++;
      } catch (e) {
        logger.warn(`Could not purge ${name} from the worktree trash, will retry: ${e}`);
      }
    }
    return purged;
  }

  /**
   * Detect orphan worktrees in the manifest that are no longer valid.
   * Called on startup to clean up after crashes.
   */
  async cleanupOrphans(repoPath: string): Promise<number> {
    // Get list of known worktrees from git
    let gitPaths: Set<string>;
    try {
      const output = await git(['worktree', 'list', '--porcelain'], repoPath);
      const blocks = output.split('\n\n').filter(Boolean);
      gitPaths = new Set<string>();
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtPathLine = lines.find((l) => l.startsWith('worktree '));
        if (wtPathLine) {
          gitPaths.add(pathKey(wtPathLine.replace('worktree ', '')));
        }
      }
    } catch {
      return 0;
    }

    const hash = this.repoHash(repoPath);

    const cleaned = await this.withManifest(async (manifest) => {
      let count = 0;

      for (const [id, entry] of Object.entries(manifest)) {
        if (entry.repoPath !== repoPath) continue;
        if (entry.direct) continue; // Direct sessions have no worktree to clean up
        if (entry.pendingRemoval) continue; // handled by processPendingRemovals

        const wtPath = path.join(this.getWorktreeRoot(), hash, id);

        let dirExists = true;
        try {
          await fs.access(wtPath);
        } catch (e) {
          // Only a missing directory is an orphan. Any other error (a lock,
          // permissions) says nothing about it: leave the entry for next time.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue;
          dirExists = false;
        }

        const gitKnows = gitPaths.has(pathKey(wtPath));

        if (!dirExists || !gitKnows) {
          logger.warn(`Found orphan worktree: ${id} (dir=${dirExists}, git=${gitKnows})`);
          if (dirExists) {
            // git no longer lists it, but the folder may still hold work.
            try {
              await this.moveToTrash(wtPath);
            } catch (e) {
              logger.error(`Failed to move orphan ${wtPath} to the trash:`, e);
              continue; // keep the entry; retry next sweep
            }
          }
          delete manifest[id];
          count++;
          logger.info(`Cleaned orphan: ${id}`);
        }
      }

      return count;
    });

    if (cleaned > 0) {
      try {
        await git(['worktree', 'prune'], repoPath);
      } catch { /* ignore */ }

      // Clean up empty repoHash directory
      const repoDir = path.join(this.getWorktreeRoot(), hash);
      try {
        const entries = await fs.readdir(repoDir);
        const remaining = entries.filter((e) => e !== CONFIG_FILE && e !== NPM_CACHE_DIR);
        if (remaining.length === 0) {
          await fs.rm(repoDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }

    return cleaned;
  }

  /**
   * Background sweep: scan the entire worktrees directory for stale entries.
   * Cleans up:
   *  1. Manifest entries whose worktree dir no longer exists or git doesn't know about
   *  2. Directories on disk that aren't in the manifest (leftover from crashes)
   *  3. Empty repo-hash directories
   * Skips any worktree that has an active in-memory session.
   */
  async sweepStaleWorktrees(): Promise<number> {
    let totalCleaned = 0;
    const root = this.getWorktreeRoot();

    // Ensure root exists
    try {
      await fs.access(root);
    } catch {
      return 0;
    }

    // Phase 0: finish removals that were deferred because the directory was
    // locked, and empty the trash of folders past their retention.
    try {
      totalCleaned += await this.processPendingRemovals();
    } catch (e) {
      logger.warn('Sweep: failed to process pending removals:', e);
    }
    await this.purgeTrash();

    const manifest = await this.loadManifest();

    // Collect unique repo paths from manifest (non-direct entries only)
    const repoPaths = new Set<string>();
    for (const entry of Object.values(manifest)) {
      if (!entry.direct && !entry.pendingRemoval) {
        repoPaths.add(entry.repoPath);
      }
    }

    // Phase 1: run per-repo orphan cleanup for every known repo
    for (const repoPath of repoPaths) {
      try {
        const cleaned = await this.cleanupOrphans(repoPath);
        totalCleaned += cleaned;
      } catch (e) {
        logger.warn(`Sweep: failed to clean orphans for ${repoPath}:`, e);
      }
    }

    // Phase 2: scan for directories on disk that aren't tracked in the manifest at all
    const activeIds = new Set([...this.worktrees.keys(), ...this.creating]);
    const freshManifest = await this.loadManifest(); // re-read after phase 1 mutations

    try {
      const hashDirs = await fs.readdir(root);
      for (const hashDir of hashDirs) {
        if (hashDir === MANIFEST_FILE || hashDir === TRASH_DIR) continue;
        const hashDirPath = path.join(root, hashDir);
        const stat = await fs.stat(hashDirPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const entries = await fs.readdir(hashDirPath);
        for (const entry of entries) {
          if (entry === CONFIG_FILE || entry === NPM_CACHE_DIR) continue;
          const entryPath = path.join(hashDirPath, entry);
          const entryStat = await fs.stat(entryPath).catch(() => null);
          if (!entryStat?.isDirectory()) continue;

          // If this directory ID is not in the manifest and not an active session, remove it.
          // Checked live, not just against the snapshot: a conversation may
          // have been created while this loop awaited.
          const live = activeIds.has(entry) || this.creating.has(entry) || this.worktrees.has(entry);
          if (!freshManifest[entry] && !live) {
            try {
              await this.moveToTrash(entryPath);
              totalCleaned++;
            } catch (e) {
              logger.warn(`Sweep: directory busy, will retry next sweep: ${entryPath}`);
            }
          }
        }

        // Clean up empty hash directory
        try {
          const remaining = (await fs.readdir(hashDirPath)).filter((e) => e !== CONFIG_FILE);
          if (remaining.length === 0) {
            await fs.rm(hashDirPath, { recursive: true, force: true });
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      logger.warn('Sweep: failed to scan worktree root:', e);
    }

    // Phase 3: clean stale direct entries whose repos no longer exist
    await this.withManifest(async (m) => {
      for (const [id, entry] of Object.entries(m)) {
        if (!entry.direct) continue;
        if (activeIds.has(id)) continue;
        try {
          const valid = await isGitRepo(entry.repoPath);
          if (!valid) {
            logger.info(`Sweep: removing stale direct entry ${id} (repo gone: ${entry.repoPath})`);
            delete m[id];
            totalCleaned++;
          }
        } catch {
          // Can't verify — leave it alone
        }
      }
    });

    if (totalCleaned > 0) {
      logger.info(`Sweep: cleaned ${totalCleaned} stale worktree(s)`);
    }

    return totalCleaned;
  }

  /**
   * Load or initialize per-repo config for auto-copy file lists.
   */
  async getRepoConfig(repoPath: string): Promise<WorktreeRepoConfig> {
    const hash = this.repoHash(repoPath);
    const configPath = path.join(this.getWorktreeRoot(), hash, CONFIG_FILE);
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(data) as WorktreeRepoConfig;
    } catch {
      // Scan for common untracked files on first use
      const copyFiles: string[] = [];
      for (const pattern of DEFAULT_COPY_PATTERNS) {
        try {
          await fs.access(path.join(repoPath, pattern));
          copyFiles.push(pattern);
        } catch { /* doesn't exist */ }
      }
      const config: WorktreeRepoConfig = { copyFiles };
      await this.saveRepoConfig(repoPath, config);
      return config;
    }
  }

  async saveRepoConfig(repoPath: string, config: WorktreeRepoConfig): Promise<void> {
    const hash = this.repoHash(repoPath);
    const configDir = path.join(this.getWorktreeRoot(), hash);
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, CONFIG_FILE),
      JSON.stringify(config, null, 2),
    );
  }

  /**
   * Return the shared npm cache directory for a repo (at the repo-hash level).
   * Created on demand.
   */
  async getNpmCachePath(repoPath: string): Promise<string> {
    const hash = this.repoHash(repoPath);
    const cachePath = path.join(this.getWorktreeRoot(), hash, NPM_CACHE_DIR);
    await fs.mkdir(cachePath, { recursive: true });
    return cachePath;
  }

  /**
   * Find node_modules in a sibling worktree for the same repo.
   * Returns the path to node_modules if found, or null.
   */
  async findSiblingNodeModules(repoPath: string, excludeId: string): Promise<string | null> {
    const hash = this.repoHash(repoPath);
    const repoDir = path.join(this.getWorktreeRoot(), hash);

    try {
      const entries = await fs.readdir(repoDir);
      for (const entry of entries) {
        if (entry === CONFIG_FILE || entry === NPM_CACHE_DIR || entry === excludeId) continue;
        const nmPath = path.join(repoDir, entry, 'node_modules');
        try {
          const stat = await fs.stat(nmPath);
          if (stat.isDirectory()) return nmPath;
        } catch { /* doesn't exist */ }
      }
    } catch { /* repoDir doesn't exist yet */ }

    return null;
  }

  private async generateAdapterSettings(wtPath: string, repoPath: string, adapterType?: string): Promise<void> {
    const adapter = adapterType ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault()) : adapterRegistry.getDefault();
    if (adapter.generateWorktreeSettings) {
      await adapter.generateWorktreeSettings(wtPath, repoPath);
    } else {
      logger.debug(`[WorktreeManager] Adapter "${adapter.id}" has no worktree settings to generate`);
    }
  }
}

export const worktreeManager = new WorktreeManager();
