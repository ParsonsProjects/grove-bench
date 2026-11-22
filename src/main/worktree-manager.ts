import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { git, excludeFromGit, FETCH_TIMEOUT_MS, isGitRepo, renameBranch as gitRenameBranch, branchHasRemote, validateBranchName, branchExists, getDefaultBranch, currentBranch, localBranchExists, remoteTrackingRef, isWorkingTreeClean, worktreeBranches, checkoutBranch } from './git.js';
import { logger } from './logger.js';
import { removeDirectory, removeDirectoryWithRetry, pathExists, readFileWithRetry, writeFileAtomic } from './fs-utils.js';
import { removeTree } from './remove-tree.js';
import type { BranchSwitchResult, BranchSyncResult, PrUpdateResult, ConversationGoal, ConversationGoalSource, LinkedCheckout, WorktreeConfig, WorktreeInfo, WorktreeRepoConfig } from '../shared/types.js';
import { adapterRegistry } from './adapters/index.js';
import type { AutoNameDecision, DisplayNameSource, DisplayNameState } from './session-auto-name.js';
import type { SavedThreadLimits } from './session-limits.js';
import { getSettings } from './settings.js';
import { isPathInside } from './agent-utils.js';
import { worktreeFolderError } from '../shared/worktree-folder.js';

const CONFIG_FILE = 'config.json';
const MANIFEST_FILE = 'manifest.json';
/** Each project's own npm cache, from before installs used the user's
 *  cache (deps-install.ts). The sweep deletes it. */
const LEGACY_NPM_CACHE_DIR = '.npm-cache';
/** Where the sweep moves worktree folders it can't account for. */
const TRASH_DIR = '.trash';
/** A name moveToTrash gives: when it moved the folder, its project's hash,
 *  its id. Nothing else in a trash is purged: Settings > Git's folder is
 *  the user's, and may hold a .trash of its own. */
const TRASH_NAME = /^(\d+)-[0-9a-f]{8}-./;
/** How long a folder stays in the trash before it is deleted. */
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Where remove() moves a thread's worktree folder while its files are
 *  deleted in the background: in the folder that holds the worktree, so the
 *  move is a rename on the same drive. Unlike the trash, nothing here is
 *  kept: the user asked for it to go. The manifest records each folder
 *  (removingPath) until it is gone, so the sweep finishes a delete that a
 *  quit cut short. */
const REMOVING_DIR = '.removing';
/** How old a folder in REMOVING_DIR with no manifest entry must be before
 *  the sweep deletes it (purgeRemoving): younger, a remove() may still be
 *  about to record it. */
const REMOVING_GRACE_MS = 10 * 60_000;
/** The name moveAside gives: the worktree's id, `~`, and when it was moved
 *  (milliseconds, base 36). No longer than the `<hash>/<id>` it replaces,
 *  so a deep node_modules path stays about as far from Windows' 260
 *  characters as it was. */
const REMOVING_NAME = /^[0-9A-Za-z_-]{1,64}~([0-9a-z]{8,9})$/;
/** Earliest time a REMOVING_NAME can carry (the year this was written): an
 *  earlier one isn't Grove's. */
const REMOVING_EPOCH_MS = Date.UTC(2026, 0, 1);

function removingName(id: string, now: number): string {
  return `${id}~${now.toString(36)}`;
}

/** When a REMOVING_NAME was given; null for any other name, or a time that
 *  can't be one (before REMOVING_EPOCH_MS, or after `now`). */
function removingNameTime(name: string, now: number): number | null {
  const match = REMOVING_NAME.exec(name);
  if (!match) return null;
  const at = parseInt(match[1], 36);
  return at >= REMOVING_EPOCH_MS && at <= now ? at : null;
}

/** Delete a folder if it is empty; anything else (not empty, not there,
 *  in use) leaves it. */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    await fs.rmdir(dir);
  } catch { /* not empty, or gone */ }
}
const DEFAULT_COPY_PATTERNS = ['.env', '.env.local', '.env.development', '.npmrc', '.nvmrc'];

/** Entries written before the agent was recorded all ran Claude Code. */
const LEGACY_AGENT_TYPE = 'claude-code';

function agentTypeOf(entry: ManifestEntry): string {
  return entry.adapterType ?? LEGACY_AGENT_TYPE;
}

/** A dollar figure or count read back from the manifest, which is plain
 *  JSON: a finite number, not below 0. */
function isUsd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
  /** Direct conversation in a folder that isn't a git repository. */
  noGit?: boolean;
  /** Explicit checkout path: for worktrees made outside the app's data
   *  folder (Settings > Git's worktree folder), and for older sessions that
   *  share another session's worktree (attached sessions). Absent for normal
   *  direct (repoPath) and worktree (worktreeRoot/hash/id) sessions, whose
   *  paths are derived. */
  path?: string;
  /** User-assigned or auto-generated display name, persisted across restart. */
  displayName?: string;
  /** Who set displayName. Auto-naming never replaces a 'user' name. Absent
   *  on entries saved before this was tracked (see decideAutoName). */
  displayNameSource?: DisplayNameSource;
  /** What the thread has spent over its life, as its agent estimated it,
   *  and how far the user let it go past its spend limit (session-limits.ts,
   *  SavedThreadLimits). Kept here because a rewind or /clear rewrites the
   *  event log they would otherwise be rebuilt from. */
  threadSpendUsd?: number;
  threadAllowanceUsd?: number;
  /** Tokens over the thread's life, kept with its spend. */
  threadInputTokens?: number;
  threadOutputTokens?: number;
  /** One-line goal pinned at the top of the Thread tab (see session-goal). */
  goal?: string;
  /** Who wrote the goal. Absent until one is generated or typed, which is
   *  what lets the automatic one run only once. */
  goalSource?: ConversationGoalSource;
  /** The goal bar was closed for this conversation. */
  goalHidden?: boolean;
  /** The session was destroyed but its directory could not be deleted (Windows
   *  file locks). The entry is hidden from listings and the background sweep
   *  retries the deletion as a known item instead of finding an orphan dir. */
  pendingRemoval?: boolean;
  /** Whether the deferred removal should also delete the branch. */
  pendingBranchDelete?: boolean;
  /** Where remove() moved the worktree folder to be deleted in the
   *  background (under REMOVING_DIR). Set with pendingRemoval: git has
   *  already forgotten the worktree, and the entry goes once this is deleted. */
  removingPath?: string;
  /** Branches Grove created for this conversation: its own branch, and any
   *  created from the branch picker. Only these may be force-deleted on
   *  removal; a branch the conversation merely switched onto may hold work
   *  that exists nowhere else. Absent on entries written before this was
   *  recorded, which get the safe delete only. */
  createdBranches?: string[];
  /** Other projects' worktrees the thread also works in
   *  (docs/linked-projects-plan.md). */
  linked?: ManifestLink[];
}

/** A linked project's worktree as the manifest keeps it: the
 *  LinkedCheckout, and what removing it needs. */
interface ManifestLink extends LinkedCheckout {
  linkedAt: number;
  /** Grove made the branch for the link, so "Also delete the branch" may
   *  force-delete it. */
  createdBranch?: boolean;
  /** Removing the thread couldn't delete this worktree yet (a file held
   *  open): the sweep retries, as git keeps its branch checked out until the
   *  worktree is pruned. */
  pendingRemoval?: boolean;
  /** Whether that retry also deletes the branch. */
  pendingBranchDelete?: boolean;
}

/** A thread's linked projects, as WorktreeInfo carries them: those not
 *  being removed. */
function linksOf(entry: Readonly<ManifestEntry>): { linked?: LinkedCheckout[] } {
  const live = (entry.linked ?? []).filter((l) => !l.pendingRemoval);
  return live.length > 0 ? { linked: live.map((l) => ({ repoPath: l.repoPath, path: l.path, branch: l.branch })) } : {};
}

type Manifest = Record<string, ManifestEntry>;
/** The manifest as reads get it: changes go through withManifest. */
type ReadonlyManifest = Readonly<Record<string, Readonly<ManifestEntry>>>;

function goalOf(entry: ManifestEntry): ConversationGoal {
  return { text: entry.goal || null, source: entry.goalSource ?? null, hidden: !!entry.goalHidden };
}

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

/** The folder a worktree is in: `<root>/<hash>/<id>`. */
function rootOf(wtPath: string): string {
  return path.dirname(path.dirname(wtPath));
}

/** createLink was asked for a branch name the thread no longer has: it
 *  was renamed meanwhile. `branch` is the name it has now. */
export class ThreadBranchMovedError extends Error {
  constructor(readonly branch: string) {
    super(`The thread's branch is now ${branch}`);
    this.name = 'ThreadBranchMovedError';
  }
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  /** What waits for a worktree to be registered (whenRegistered), by id. */
  private registrationWaiters = new Map<string, Set<(info: WorktreeInfo) => void>>();
  /** Ids whose worktree directory is being created: on disk before it is in
   *  the manifest or in `worktrees`, so the sweep must leave it alone. */
  private creating = new Set<string>();
  /** Ids whose moved-aside folder is being deleted in the background right
   *  now (finishRemoval), so the sweep doesn't delete it at the same time. */
  private finishing = new Map<string, Promise<void>>();
  /** The manifest with every change made this run, on disk or still being
   *  written. Read from disk once: this is the only copy of the app
   *  (single-instance lock) and the only writer, so later reads never touch
   *  the disk, and never wait behind a write when the disk is slow. */
  private manifest: Manifest | null = null;
  /** The first read of the manifest, shared by the callers that ask meanwhile. */
  private manifestLoad: Promise<void> | null = null;
  /** Bumped by every change; manifestWritten is the newest one on disk. */
  private manifestVersion = 0;
  private manifestWritten = 0;
  /** The write under way, and the newest change it carries. */
  private manifestWrite: { done: Promise<void>; version: number } | null = null;
  /** Per-repo locks to serialize git worktree operations (e.g. concurrent removes). */
  private repoLocks = new Map<string, Promise<void>>();
  private threadLocks = new Map<string, Promise<void>>();

  /** `worktreeFolder`: Settings > Git's worktree folder (empty: the app's
   *  data folder), read when a worktree is made and by the sweep. */
  constructor(private readonly worktreeFolder: () => string = () => '') {}

  /** Serialize operations on the same repo to prevent concurrent git conflicts. */
  private async withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    return this.withLock(this.repoLocks, repoPath, fn);
  }

  /** Thread `id`'s branch name and its linked worktrees change one at a
   *  time: a link made while the branch is renamed would get the old name
   *  (createLink, renameBranch). */
  private async withThreadLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.withLock(this.threadLocks, id, fn);
  }

  /** Run `fn` once every earlier call for `key` in `locks` is done. */
  private async withLock<T>(locks: Map<string, Promise<void>>, key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    locks.set(key, next);
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
      // Clean up lock entry when queue is drained
      if (locks.get(key) === next) {
        locks.delete(key);
      }
    }
  }

  /**
   * Change the manifest. `fn` changes a copy, which replaces the manifest at
   * once, so every read from then on sees the change; then it is written,
   * and this resolves once a write holding it is on disk. Changes made while
   * a write is under way go in the next write together: ten agents finishing
   * turns cost a write or two, not one each, and one change never waits
   * behind a queue of whole-file writes. `fn` must be synchronous (do any
   * I/O before), so no change can land between its read and its write. The
   * manifest is written unless `changed` says `fn` left it as it was.
   */
  private async withManifest<T>(
    fn: (manifest: Manifest) => T,
    changed: (result: T) => boolean = () => true,
  ): Promise<T> {
    // Applied as soon as the manifest is in memory (at once after the first
    // read), so a read asked for after this one sees it.
    if (!this.manifest) await this.firstManifestRead();
    const draft = structuredClone(this.manifest!);
    const result = fn(draft);
    if (result instanceof Promise) throw new Error('withManifest needs a synchronous change');
    if (!changed(result)) return result;
    this.manifest = draft;
    await this.writeManifest(++this.manifestVersion);
    return result;
  }

  /**
   * Wait until change `version` is on disk, starting a write of the latest
   * manifest when none is under way. A failed write rejects the changes it
   * carried. They stay in memory, so reads still see them, and go with the
   * next write (the next change's, or a later change's waiting on this one).
   */
  private async writeManifest(version: number): Promise<void> {
    while (this.manifestWritten < version) {
      if (!this.manifestWrite) {
        const carries = this.manifestVersion;
        const done = this.saveManifest(this.manifest!)
          .then(() => { this.manifestWritten = carries; })
          .finally(() => { this.manifestWrite = null; });
        this.manifestWrite = { done, version: carries };
      }
      const write = this.manifestWrite;
      try {
        await write.done;
      } catch (e) {
        if (write.version >= version) throw e;
      }
    }
  }

  /** The app's data folder for worktrees: the manifest, each project's
   *  config and, unless Settings > Git names another folder, the worktrees. */
  private getWorktreeRoot(): string {
    return path.join(app.getPath('userData'), 'worktrees');
  }

  /** A conversation's checkout: its recorded path (a worktree made outside
   *  the data folder, an older attached conversation), the project folder
   *  for a direct one, else `<data folder>/<hash>/<id>`. */
  private checkoutPath(id: string, entry: Readonly<ManifestEntry>): string {
    return entry.path ?? (entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), this.repoHash(entry.repoPath), id));
  }

  /** Every folder that holds worktrees: the data folder, Settings > Git's
   *  folder, and the folders of worktrees made while it named another. */
  private worktreeRoots(manifest: ReadonlyManifest): string[] {
    const roots = [this.getWorktreeRoot()];
    const add = (root: string) => {
      // The data folder, or one inside it, which create refuses.
      if (isPathInside(roots[0], root)) return;
      if (!roots.some((r) => samePath(r, root))) roots.push(root);
    };
    const folder = this.worktreeFolder().trim();
    if (folder && !worktreeFolderError(folder, process.platform === 'win32')) add(path.resolve(folder));
    for (const entry of Object.values(manifest)) {
      if (!entry.direct && entry.path) add(rootOf(entry.path));
      // Linked worktrees may be in a folder the setting no longer names.
      for (const link of entry.linked ?? []) add(rootOf(link.path));
    }
    return roots;
  }

  /**
   * Make Settings > Git's worktree folder ready for a worktree of `repoPath`
   * and return its real path. Git records a worktree under its real path
   * (through a mapped or subst drive, a junction or a symlink), and a typed
   * path that doesn't match `git worktree list` makes a live worktree look
   * like an orphan. fs.realpath is the native call, as git's is.
   */
  private async customWorktreeRoot(folder: string, repoPath: string): Promise<string> {
    const refuse = (why: string, cause?: unknown) =>
      new Error(`Can't make the worktree in ${folder}: ${why} Change the worktree folder in Settings > Git.`, { cause });
    const error = worktreeFolderError(folder, process.platform === 'win32');
    if (error) throw refuse(error);
    const dataRoot = this.getWorktreeRoot();
    const check = (root: string) => {
      // The data folder's own scan would take its project folders for leftovers.
      if (isPathInside(dataRoot, root)) throw refuse(`it is inside the app's data folder, ${dataRoot}.`);
      // Its worktrees would show in the project's git status, searches and builds.
      if (isPathInside(repoPath, root)) throw refuse(`it is inside the project, ${repoPath}.`);
    };
    check(path.resolve(folder));
    let real: string;
    try {
      await fs.mkdir(path.resolve(folder), { recursive: true });
      real = await fs.realpath(path.resolve(folder));
    } catch (e) {
      throw refuse(`${(e as Error).message}.`, e);
    }
    check(real);
    return real;
  }

  /** Unlock a worktree made outside the data folder (create locks those), so
   *  git can remove it and prune its record. */
  private async unlockWorktree(repoPath: string, wtPath: string): Promise<void> {
    if (isPathInside(this.getWorktreeRoot(), wtPath)) return;
    try {
      await git(['worktree', 'unlock', wtPath], repoPath);
    } catch { /* not locked, or git no longer knows it */ }
  }

  /** Delete a project's folder of worktrees once none are left in it. What
   *  may remain is its config (in the data folder) or the old npm cache. */
  private async removeEmptyHashDir(hashDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(hashDir);
      const remaining = entries.filter((e) => e !== CONFIG_FILE && e !== LEGACY_NPM_CACHE_DIR);
      if (remaining.length === 0) {
        await fs.rm(hashDir, { recursive: true, force: true });
      }
    } catch { /* directory may not exist */ }
  }

  private repoHash(repoPath: string): string {
    return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 8);
  }

  /** The manifest, read from disk the first time (see `manifest`), with
   *  every change asked for before this, even while that first read ran. */
  private loadManifest(): Promise<ReadonlyManifest> {
    if (this.manifest) return Promise.resolve(this.manifest);
    return this.firstManifestRead().then(() => this.manifest!);
  }

  /** Read the file into `manifest`, once for everyone who asks meanwhile.
   *  Who waits on it goes on in the order they asked (see withManifest). */
  private firstManifestRead(): Promise<void> {
    this.manifestLoad ??= this.readManifest()
      .then((read) => { this.manifest ??= read; })
      .finally(() => { this.manifestLoad = null; });
    return this.manifestLoad;
  }

  /**
   * Read the manifest file. Only a missing file reads as empty: an
   * unreadable or corrupt one throws (and the next read tries again).
   * Treating those as empty used to be destructive: the next write saved the
   * empty manifest over every entry, and the sweep then deleted each
   * worktree directory it no longer found listed.
   */
  private async readManifest(): Promise<Manifest> {
    const manifestPath = path.join(this.getWorktreeRoot(), MANIFEST_FILE);
    let data: string;
    try {
      data = await readFileWithRetry(manifestPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error(`Could not read the worktree manifest ${manifestPath}: ${(e as Error).message}`, { cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      throw new Error(`The worktree manifest ${manifestPath} is corrupt: ${(e as Error).message}`, { cause: e });
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

  /** Where a new worktree of `repoPath` goes: Settings > Git's worktree
   *  folder (a Dev Drive, say), else the data folder. */
  private async newWorktreeRoot(repoPath: string): Promise<{ root: string; inDataFolder: boolean }> {
    const dataRoot = this.getWorktreeRoot();
    const folder = this.worktreeFolder().trim();
    const root = folder && !samePath(path.resolve(folder), dataRoot) ? await this.customWorktreeRoot(folder, repoPath) : dataRoot;
    return { root, inDataFolder: root === dataRoot };
  }

  async create(config: WorktreeConfig): Promise<WorktreeInfo> {
    const { repoPath, branchName, baseBranch, useExisting } = config;

    const id = config.id ?? crypto.randomUUID().slice(0, 8);
    const hash = this.repoHash(repoPath);
    const { root, inDataFolder } = await this.newWorktreeRoot(repoPath);
    const wtPath = path.join(root, hash, id);
    // Locked outside the data folder: that folder may be on a drive that
    // isn't always connected, and a prune (Grove's, or git gc's) would drop
    // git's record of a worktree it can't see. remove() unlocks it.
    const lock = inDataFolder ? [] : ['--lock'];

    this.creating.add(id);
    try {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(wtPath), { recursive: true });

      // Create worktree: existing branch or new branch. A new branch whose
      // name is taken fails here: git refuses, and nothing is deleted to make
      // room (the name may belong to another conversation's worktree).
      if (useExisting) {
        await git(['worktree', 'add', ...lock, wtPath, branchName], repoPath);
      } else {
        // Pull the latest base branch so the new agent starts from what's on origin
        const startPoint = baseBranch ? await this.pullBaseBranch(repoPath, baseBranch) : undefined;
        await git(['worktree', 'add', ...lock, '-b', branchName, wtPath, ...(startPoint ? [startPoint] : [])], repoPath);
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

      this.setWorktree(info);

      // Write entry to manifest
      await this.withManifest((manifest) => {
        manifest[id] = {
          repoPath,
          branch: branchName,
          createdAt: info.createdAt,
          // Outside the data folder the path can't be derived, and the
          // setting may name another folder by the time it's read back.
          ...(inDataFolder ? {} : { path: wtPath }),
          ...(useExisting ? {} : { createdBranches: [branchName] }),
        };
      });

      return info;
    } finally {
      this.creating.delete(id);
    }
  }

  /**
   * Make a worktree of another project (`repoPath`) for thread `id` and
   * record it as one of the thread's linked projects
   * (docs/linked-projects-plan.md). It goes where the thread's own would,
   * as <worktree folder>/<project hash>/<thread id>: the sweep keeps a
   * folder named after a thread it knows. `useExisting` checks out
   * `branchName`, which must exist and not be checked out elsewhere;
   * otherwise a new branch is made from `baseBranch`, brought up to date
   * first.
   */
  async createLink(id: string, config: { repoPath: string; branchName: string; baseBranch?: string; useExisting?: boolean }): Promise<LinkedCheckout> {
    return this.withThreadLock(id, () => this.createLinkLocked(id, config));
  }

  private async createLinkLocked(id: string, config: { repoPath: string; branchName: string; baseBranch?: string; useExisting?: boolean }): Promise<LinkedCheckout> {
    const { repoPath, branchName, baseBranch, useExisting } = config;
    const info = this.worktrees.get(id);
    if (!info) throw new Error(`Thread ${id} not found`);
    // Renamed since the caller read it (the name after the first reply):
    // the caller checks the new name and asks again.
    if (!info.direct && info.branch !== branchName) throw new ThreadBranchMovedError(info.branch);
    if (samePath(info.repoPath, repoPath)) throw new Error("A thread can't link its own project.");
    if ((info.linked ?? []).some((l) => samePath(l.repoPath, repoPath))) {
      throw new Error(`This thread already works in ${path.basename(repoPath)}.`);
    }
    const { root, inDataFolder } = await this.newWorktreeRoot(repoPath);
    const wtPath = path.join(root, this.repoHash(repoPath), id);
    // As create(): locked outside the data folder, so a prune can't drop it
    // while its drive is away.
    const lock = inDataFolder ? [] : ['--lock'];
    await fs.mkdir(path.dirname(wtPath), { recursive: true });
    if (useExisting) {
      await git(['worktree', 'add', ...lock, wtPath, branchName], repoPath);
    } else {
      const startPoint = baseBranch ? await this.pullBaseBranch(repoPath, baseBranch) : undefined;
      await git(['worktree', 'add', ...lock, '-b', branchName, wtPath, ...(startPoint ? [startPoint] : [])], repoPath);
    }
    const link: LinkedCheckout = { repoPath, path: wtPath, branch: branchName };
    const recorded = await this.withManifest((manifest) => {
      const entry = manifest[id];
      if (!entry || entry.pendingRemoval) return false;
      entry.linked = [...(entry.linked ?? []), { ...link, linkedAt: Date.now(), ...(useExisting ? {} : { createdBranch: true }) }];
      return true;
    }, (done) => done);
    if (!recorded) {
      // The thread was deleted meanwhile: nothing would remove this.
      await this.removeLink(id, { ...link, linkedAt: Date.now(), ...(useExisting ? {} : { createdBranch: true }) }, !useExisting)
        .catch((e) => logger.warn(`Could not remove the linked worktree ${wtPath} of deleted thread ${id}: ${e}`));
      throw new Error('The thread was deleted while its linked project was being set up.');
    }
    const live = this.worktrees.get(id);
    if (live) live.linked = [...(live.linked ?? []), link];
    return link;
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
   * Register a "direct" session — runs in-place on the repo checkout, no new
   * worktree created. Still tracked in the manifest for session ID persistence.
   * (Older manifests may hold "attached" direct sessions that ran in another
   * session's worktree; they carry a stored `path`, read back on restart.)
   */
  async registerDirect(repoPath: string, branch: string, opts: { noGit?: boolean; id?: string } = {}): Promise<WorktreeInfo> {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);

    const info: WorktreeInfo = {
      id,
      path: repoPath,
      branch,
      repoPath,
      createdAt: Date.now(),
      direct: true,
      ...(opts.noGit ? { noGit: true } : {}),
    };

    this.setWorktree(info);

    await this.withManifest((manifest) => {
      manifest[id] = {
        repoPath,
        branch,
        createdAt: info.createdAt,
        direct: true,
        ...(opts.noGit ? { noGit: true } : {}),
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

  /** Persist the model a session is running with so it survives app restart.
   *  Null forgets it (an agent switched to that has no model yet starts on
   *  its own default). */
  async saveModel(worktreeId: string, model: string | null): Promise<void> {
    await this.withManifest((manifest) => {
      if (!manifest[worktreeId]) return;
      if (model) manifest[worktreeId].model = model;
      else delete manifest[worktreeId].model;
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

  /** Record a thread's spend, spend allowance and tokens (see ManifestEntry.threadSpendUsd).
   *  Tokens are left as they were when there are none to save: the thread's
   *  count only grows. */
  async saveThreadLimits(worktreeId: string, saved: SavedThreadLimits): Promise<void> {
    await this.withManifest((manifest) => {
      const entry = manifest[worktreeId];
      if (!entry) return false;
      entry.threadSpendUsd = saved.spendUsd;
      if (saved.allowanceUsd !== undefined) entry.threadAllowanceUsd = saved.allowanceUsd;
      else delete entry.threadAllowanceUsd;
      if (saved.tokens) {
        entry.threadInputTokens = saved.tokens.input;
        entry.threadOutputTokens = saved.tokens.output;
      }
      return true;
    }, (written) => written);
  }

  /** A thread's spend, allowance and tokens when last saved, or undefined when none
   *  was (an unknown thread, or one that hasn't been saved since this was
   *  kept). A save still being written is seen: the manifest in memory has it. */
  async getThreadLimits(worktreeId: string): Promise<SavedThreadLimits | undefined> {
    const entry = (await this.loadManifest())[worktreeId];
    if (!entry || !isUsd(entry.threadSpendUsd)) return undefined;
    return {
      spendUsd: entry.threadSpendUsd,
      ...(isUsd(entry.threadAllowanceUsd) ? { allowanceUsd: entry.threadAllowanceUsd } : {}),
      ...(isUsd(entry.threadInputTokens) && isUsd(entry.threadOutputTokens)
        ? { tokens: { input: entry.threadInputTokens, output: entry.threadOutputTokens } } : {}),
    };
  }

  /** The agent a session runs, or undefined for an unknown session. */
  async getAdapterType(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    const entry = manifest[worktreeId];
    return entry ? agentTypeOf(entry) : undefined;
  }

  /** getAdapterType and getModel from one read of the manifest. */
  async getAgentAndModel(worktreeId: string): Promise<{ adapterType?: string; model?: string }> {
    const entry = (await this.loadManifest())[worktreeId];
    return entry ? { adapterType: agentTypeOf(entry), model: entry.model } : {};
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

  /** A conversation's goal (undefined for unknown ids). */
  async getGoal(worktreeId: string): Promise<ConversationGoal | undefined> {
    const entry = (await this.loadManifest())[worktreeId];
    return entry && !entry.pendingRemoval ? goalOf(entry) : undefined;
  }

  /** Several conversations' goals from one manifest read (the sidebar's
   *  tooltips). Unknown ids are left out. */
  async getGoals(worktreeIds: string[]): Promise<Record<string, ConversationGoal>> {
    const manifest = await this.loadManifest();
    const goals: Record<string, ConversationGoal> = {};
    for (const id of worktreeIds) {
      const entry = manifest[id];
      if (entry && !entry.pendingRemoval) goals[id] = goalOf(entry);
    }
    return goals;
  }

  /** Save a goal. With `expected`, only while the goal is still what it was
   *  when `expected` was read, so an edit made while one was being generated
   *  is never overwritten. Returns the saved goal, or null when nothing was
   *  saved. */
  async saveGoal(
    worktreeId: string,
    text: string,
    source: ConversationGoalSource,
    expected?: ConversationGoal,
  ): Promise<ConversationGoal | null> {
    return this.withManifest((manifest) => {
      const entry = manifest[worktreeId];
      if (!entry || entry.pendingRemoval) return null;
      if (expected) {
        const now = goalOf(entry);
        if (now.text !== expected.text || now.source !== expected.source) return null;
      }
      entry.goal = text || undefined;
      entry.goalSource = source;
      return goalOf(entry);
    }, (saved) => saved !== null);
  }

  /** Close or reopen a conversation's goal bar. */
  async setGoalHidden(worktreeId: string, hidden: boolean): Promise<ConversationGoal | null> {
    let changed = false;
    return this.withManifest((manifest) => {
      const entry = manifest[worktreeId];
      if (!entry || entry.pendingRemoval) return null;
      changed = !!entry.goalHidden !== hidden;
      entry.goalHidden = hidden || undefined;
      return goalOf(entry);
    }, () => changed);
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
      `${others.length === 1 ? 'Another thread is' : `${others.length} other threads are`} still working in this thread's worktree. `
      + 'Delete them first; deleting this one would remove their checkout too.',
    );
  }

  async remove(id: string, deleteBranch = false): Promise<void> {
    await this.assertRemovable(id);
    // Linked projects' worktrees first. Any left (a file held open) keep the
    // entry, hidden, for the sweep to finish.
    const linksLeft = await this.removeLinks(id, deleteBranch);
    let info = this.worktrees.get(id);
    const createdBranches = deleteBranch ? (await this.loadManifest())[id]?.createdBranches : undefined;

    // Fall back to manifest if not in memory (e.g. after restart)
    if (!info) {
      const manifest = await this.loadManifest();
      const entry = manifest[id];
      if (!entry) return;
      info = {
        id,
        path: this.checkoutPath(id, entry),
        branch: entry.branch,
        repoPath: entry.repoPath,
        createdAt: entry.createdAt,
        lastActiveAt: entry.lastActiveAt,
        direct: entry.direct,
        ...(entry.noGit ? { noGit: true } : {}),
      };
    }

    const { path: wtPath, repoPath, branch } = info;

    // Serialize git operations per-repo to prevent concurrent worktree remove conflicts
    await this.withRepoLock(repoPath, async () => {
      let dirRemoved = true;
      if (!info.direct) {
        await this.unlockWorktree(repoPath, wtPath);
        // Fast path. Deleting a worktree's files (node_modules and all) is
        // what made removal slow, on Windows above all: move the folder
        // aside instead (a rename), let git forget it, and delete the files
        // in the background. Only Grove's own layout (<root>/<hash>/<id>).
        const moved = path.basename(wtPath) === id ? await this.moveAside(wtPath) : null;
        if (moved) {
          // The folder is gone from where git expects it, so prune drops
          // the worktree and frees its branch. If it fails, the branch is
          // still checked out there: the sweep prunes and deletes it later.
          let pruned = true;
          try {
            await git(['worktree', 'prune'], repoPath);
          } catch (e) {
            pruned = false;
            logger.warn(`git worktree prune failed after moving ${id} aside; the sweep will retry: ${e}`);
          }
          this.worktrees.delete(id);
          if (deleteBranch && pruned) {
            await this.deleteConversationBranches(repoPath, wtPath, branch, createdBranches);
          }
          // Kept (hidden) until the files are deleted, so a quit before then
          // leaves the sweep a known folder to finish.
          await this.withManifest((manifest) => {
            const entry = manifest[id];
            if (!entry) return;
            entry.pendingRemoval = true;
            entry.removingPath = moved;
            if (deleteBranch && !pruned) entry.pendingBranchDelete = true;
            else delete entry.pendingBranchDelete;
          });
          void this.finishRemoval(id, moved, path.dirname(wtPath));
          return;
        }
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
        if (linksLeft > 0 && manifest[id]) manifest[id].pendingRemoval = true;
        else delete manifest[id];
      });

      // Clean up empty repoHash directory (skip for direct — no worktree dir was created)
      if (!info.direct) {
        await this.removeEmptyHashDir(path.dirname(wtPath));
      }
    });
  }

  /** A linked worktree outside the data folder whose folder of worktrees
   *  isn't there (a drive not connected): nothing can be said about it yet,
   *  and git must keep its lock on it, so it is left as it is. */
  private async linkOutOfReach(link: Readonly<LinkedCheckout>): Promise<boolean> {
    return !isPathInside(this.getWorktreeRoot(), link.path) && !(await pathExists(rootOf(link.path)));
  }

  /**
   * Remove thread `id`'s linked worktrees, each as remove() does the
   * thread's own: moved aside and deleted in the background, pruned from
   * its project, and its branch deleted when asked (force-deleted only when
   * Grove made it). One that can't be removed yet stays in the entry,
   * marked pendingRemoval, for the sweep: git keeps a worktree's branch
   * checked out until the worktree is pruned. Returns how many are left.
   */
  private async removeLinks(id: string, deleteBranch: boolean): Promise<number> {
    const links = (await this.loadManifest())[id]?.linked ?? [];
    if (links.length === 0) return 0;
    const left: ManifestLink[] = [];
    for (const link of links) {
      const withBranch = deleteBranch || !!link.pendingBranchDelete;
      const removed = await this.removeLink(id, link, withBranch).catch((e: unknown) => {
        logger.warn(`Could not remove linked worktree ${link.path} of thread ${id}; the sweep will retry: ${String(e)}`);
        return false;
      });
      if (!removed) left.push({ ...link, pendingRemoval: true, ...(withBranch ? { pendingBranchDelete: true } : {}) });
    }
    await this.withManifest((manifest) => {
      const entry = manifest[id];
      if (!entry) return;
      if (left.length > 0) entry.linked = left;
      else delete entry.linked;
    });
    const live = this.worktrees.get(id);
    if (live) delete live.linked;
    return left.length;
  }

  /**
   * Unlink a project from thread `id` part way through: its worktree is
   * removed as removeLinks does, and its branch deleted when asked (only
   * when Grove made it, unless merged). Throws, keeping the link, when the
   * worktree can't be removed now (a file held open). Returns what was
   * unlinked.
   */
  async unlinkProject(id: string, repoPath: string, deleteBranch: boolean): Promise<LinkedCheckout> {
    const link = (await this.loadManifest())[id]?.linked?.find((l) => !l.pendingRemoval && samePath(l.repoPath, repoPath));
    if (!link) throw new Error(`This thread doesn't work in ${path.basename(repoPath)}.`);
    if (!(await this.removeLink(id, link, deleteBranch, false))) {
      throw new Error(`The worktree of ${path.basename(repoPath)} is in ${rootOf(link.path)}, which isn't there. Connect its drive and try again.`);
    }
    await this.withManifest((manifest) => {
      const entry = manifest[id];
      if (!entry?.linked) return;
      const kept = entry.linked.filter((l) => !samePath(l.path, link.path));
      if (kept.length > 0) entry.linked = kept;
      else delete entry.linked;
    });
    const live = this.worktrees.get(id);
    if (live?.linked) {
      const kept = live.linked.filter((l) => !samePath(l.path, link.path));
      if (kept.length > 0) live.linked = kept;
      else delete live.linked;
    }
    return { repoPath: link.repoPath, path: link.path, branch: link.branch };
  }

  /** Remove one linked worktree (removeLinks). False when its folder or
   *  git's record of it is still there. */
  private async removeLink(id: string, link: Readonly<ManifestLink>, deleteBranch: boolean, inPlace = true): Promise<boolean> {
    return this.withRepoLock(link.repoPath, async () => {
      const there = await pathExists(link.path);
      // Its drive isn't connected: pruning would drop git's lock on it, and
      // its folder would come back with no record. It stays pending.
      if (!there && await this.linkOutOfReach(link)) {
        logger.info(`Linked worktree ${link.path} is on a drive that isn't connected; will retry`);
        return false;
      }
      // The branch it has now, which the delete dialog's "Also delete the
      // branch" means, else the one it was linked on.
      const current = (there ? await currentBranch(link.path).catch(() => null) : null) ?? link.branch;
      if (there) {
        await this.unlockWorktree(link.repoPath, link.path);
        const moved = path.basename(link.path) === id ? await this.moveAside(link.path) : null;
        if (moved) {
          // A quit before this finishes leaves it to purgeRemoving.
          void removeTree(moved)
            .then(() => removeIfEmpty(path.dirname(moved)))
            .catch((e: unknown) => logger.warn(`Could not delete ${moved} yet; the sweep will: ${String(e)}`));
        } else if (!inPlace) {
          // Deleting in place could stop part way and leave a worktree, still
          // linked, with files missing. Left whole instead.
          throw new Error(`Files in the worktree of ${path.basename(link.repoPath)} are still in use, so it wasn't removed. Close whatever has them open and try again.`);
        } else {
          try {
            await git(['worktree', 'remove', '--force', link.path], link.repoPath);
          } catch {
            await removeDirectoryWithRetry(link.path);
          }
        }
      }
      await git(['worktree', 'prune'], link.repoPath);
      if (deleteBranch) {
        await this.deleteConversationBranches(link.repoPath, link.path, current, link.createdBranch ? [link.branch] : []);
      }
      await this.removeEmptyHashDir(path.dirname(link.path));
      return true;
    });
  }

  /** The names (else branches) of the threads that work in `repoPath`
   *  through a linked worktree. */
  async threadsLinking(repoPath: string): Promise<string[]> {
    const manifest = await this.loadManifest();
    return Object.values(manifest).flatMap((entry) =>
      !entry.pendingRemoval && (entry.linked ?? []).some((l) => !l.pendingRemoval && samePath(l.repoPath, repoPath))
        ? [entry.displayName || entry.branch]
        : []);
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
      // Still being deleted in the background: not twice at once.
      if (this.finishing.has(id)) continue;
      const wtPath = this.checkoutPath(id, entry);
      // In a folder that isn't there (a drive not connected yet) there is
      // nothing to remove yet: it stays pending, or it would be left behind.
      if (!entry.direct && entry.path && !(await pathExists(rootOf(wtPath)))) {
        logger.info(`Sweep: worktree ${id} is in ${rootOf(wtPath)}, which isn't there; will retry next sweep`);
        continue;
      }
      // A folder remove() moved aside is deleted from where it went.
      const folder = entry.removingPath ?? wtPath;
      try {
        await this.withRepoLock(entry.repoPath, async () => {
          if (!entry.direct && (await pathExists(folder))) {
            await removeTree(folder);
          }
          if (!entry.direct) await this.unlockWorktree(entry.repoPath, wtPath);
          try { await git(['worktree', 'prune'], entry.repoPath); } catch { /* repo may be gone */ }
          if (entry.pendingBranchDelete && !entry.direct) {
            await this.deleteConversationBranches(entry.repoPath, wtPath, entry.branch, entry.createdBranches);
          }
        });
        // Each link carries whether to delete its branch.
        if ((await this.removeLinks(id, false)) > 0) {
          // The thread's own part is done; only the links are retried.
          await this.withManifest((m) => {
            if (!m[id]) return;
            delete m[id].removingPath;
            delete m[id].pendingBranchDelete;
          });
          logger.info(`Sweep: a linked worktree of ${id} is still locked, will retry next sweep`);
          continue;
        }
        await this.withManifest((m) => { delete m[id]; });
        if (entry.removingPath) await removeIfEmpty(path.dirname(entry.removingPath));
        if (!entry.direct) await this.removeEmptyHashDir(path.dirname(wtPath));
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
      // A folder project isn't a git repository: only its direct
      // conversations are listed, and they need no git.
      const output = await git(['worktree', 'list', '--porcelain'], repoPath).catch(() => '');
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
            ...(entry.noGit ? { noGit: true } : {}),
            displayName: entry.displayName ?? null,
            agentType: agentTypeOf(entry),
            ...linksOf(entry),
          });
          continue;
        }

        const wtPath = this.checkoutPath(id, entry);
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
          agentType: agentTypeOf(entry),
          ...linksOf(entry),
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
    await this.copyProjectFiles(info.repoPath, info.path, files);
  }

  /** Copy `files` (paths in the project, such as .env) from the project
   *  folder into one of its worktrees, skipping those it doesn't have. */
  async copyProjectFiles(repoPath: string, worktreePath: string, files: string[]): Promise<void> {
    for (const file of files) {
      const src = path.join(repoPath, file);
      const dest = path.join(worktreePath, file);
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
    return this.withThreadLock(id, () => this.renameBranchLocked(id, newName));
  }

  private async renameBranchLocked(id: string, newName: string): Promise<string> {
    const info = this.worktrees.get(id);
    if (!info) {
      // Fall back to manifest
      const manifest = await this.loadManifest();
      const entry = manifest[id];
      if (!entry) throw new Error(`Worktree ${id} not found`);
      throw new Error(`Thread ${id} is not active`);
    }

    if (info.direct) {
      throw new Error('Cannot rename branch for direct threads');
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

    // Linked projects on the same branch name are renamed with it, so every
    // project is checked first: all or none.
    const links = (info.linked ?? []).filter((l) => l.branch === oldName);
    for (const link of links) {
      const project = path.basename(link.repoPath);
      if (await branchExists(link.repoPath, newName)) throw new Error(`Branch "${newName}" already exists in ${project}`);
      if (await branchHasRemote(link.repoPath, oldName)) {
        throw new Error(`Branch "${oldName}" has been pushed to a remote in ${project} and cannot be renamed`);
      }
    }

    // Rename via git (run in the worktree so it renames the checked-out branch)
    await gitRenameBranch(info.path, oldName, newName);
    const renamed: LinkedCheckout[] = [];
    try {
      // In the project folder: branches belong to the repository, so this
      // renames the one the worktree has checked out too, and works when
      // the worktree's folder is gone.
      for (const link of links) {
        await gitRenameBranch(link.repoPath, oldName, newName);
        renamed.push(link);
      }
    } catch (e) {
      // Put back the ones done, so every project still has the old name.
      for (const done of [...renamed].reverse()) {
        await gitRenameBranch(done.repoPath, newName, oldName).catch((undo: unknown) => logger.warn(`Could not rename ${newName} back in ${done.repoPath}: ${String(undo)}`));
      }
      await gitRenameBranch(info.path, newName, oldName).catch((undo: unknown) => logger.warn(`Could not rename ${newName} back in ${info.path}: ${String(undo)}`));
      throw e;
    }

    // Update in-memory
    info.branch = newName;
    for (const link of links) link.branch = newName;

    // Update manifest
    await this.withManifest((manifest) => {
      const entry = manifest[id];
      if (entry) {
        entry.branch = newName;
        if (entry.createdBranches) {
          entry.createdBranches = entry.createdBranches.map((b) => (b === oldName ? newName : b));
        }
        for (const link of entry.linked ?? []) {
          if (link.branch === oldName && links.some((l) => samePath(l.path, link.path))) link.branch = newName;
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
      if (samePath(this.checkoutPath(otherId, entry), checkoutPath)) ids.add(otherId);
    }
    return [...ids];
  }

  /**
   * Check out another branch in a conversation's checkout: an existing local
   * branch, a remote-only branch (a local tracking branch is created), or
   * with `create` a new branch at HEAD. Every conversation sharing the
   * checkout moves with it, so all their recorded branches are updated.
   *
   * Refused when a conversation sharing the checkout is working, mid-turn
   * or with a background agent running (`busySessionIds`, which only the
   * renderer knows), when the tree has
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
    if (!info) return { success: false, error: 'This thread is not active.' };
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
        return { success: false, error: 'An agent is working in this checkout. Wait for it to finish, then switch.' };
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
      } catch (e) {
        const err = e as { stderr?: string; message?: string } | null;
        return { success: false, error: (err?.stderr || err?.message || String(e)).trim().slice(0, 500) };
      }

      await this.recordBranch(sharers, name, { created: create });
      return { success: true, branch: name, sessionIds: sharers };
    });
  }

  /** The commit `branch` points at on origin, from the thread's checkout;
   *  null when it isn't there or origin can't be reached. */
  async remoteHead(id: string, branch: string): Promise<string | null> {
    const info = this.worktrees.get(id);
    if (!info) return null;
    try {
      const out = await git(['ls-remote', 'origin', `refs/heads/${branch}`], info.path, { timeout: FETCH_TIMEOUT_MS });
      return /^([0-9a-f]{40,64})\s/i.exec(out)?.[1].toLowerCase() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Bring a thread's checkout up to date once its PR's branch was updated
   * on GitHub (Update branch, in the branch popup). `from` is where the
   * branch was on origin before.
   *
   * GitHub can move the branch a moment after gh returns, so this waits for
   * it to move first. Then, under the repo lock, it changes the checkout
   * only when nobody is working in it (`isBusy`, for every thread sharing
   * it), it is on `branch`, and it holds exactly `from`: nothing unpushed,
   * nothing missing. So nothing local is lost: a merge update
   * fast-forwards, and a rebase update, whose commits are all new, moves the
   * branch to GitHub's with `reset --keep`, which keeps uncommitted changes
   * and stops rather than overwrite them.
   */
  async catchUpWithRemote(id: string, opts: {
    branch: string;
    from: string | null;
    rebase: boolean;
    isBusy: (sessionId: string) => boolean;
    /** How long to wait for GitHub to move the branch, and how often to look. */
    waitMs?: number;
    pollMs?: number;
  }): Promise<PrUpdateResult> {
    const info = this.worktrees.get(id);
    if (!info) return { pulled: false, skipped: 'other-branch' };
    const deadline = Date.now() + (opts.waitMs ?? 15_000);
    let to: string | null;
    for (;;) {
      to = await this.remoteHead(id, opts.branch);
      if (to && to !== opts.from) break;
      if (Date.now() >= deadline) return { pulled: false, skipped: 'not-yet' };
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 1000));
    }
    const target = to;

    return this.withRepoLock(info.repoPath, async (): Promise<PrUpdateResult> => {
      const cwd = info.path;
      if (this.worktrees.get(id) !== info) return { pulled: false, skipped: 'other-branch' };
      if ((await this.checkoutSharers(id)).some((s) => opts.isBusy(s))) return { pulled: false, skipped: 'busy' };
      if ((await currentBranch(cwd)) !== opts.branch) return { pulled: false, skipped: 'other-branch' };
      try {
        const head = (await git(['rev-parse', 'HEAD'], cwd)).trim().toLowerCase();
        if (!opts.from || head !== opts.from) return { pulled: false, skipped: 'diverged' };
        await git(['fetch', 'origin', `refs/heads/${opts.branch}`], cwd, { timeout: FETCH_TIMEOUT_MS });
        await git(opts.rebase ? ['reset', '--keep', target] : ['merge', '--ff-only', target], cwd);
        return { pulled: true };
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        return { pulled: false, pullError: (err.stderr || err.message || String(e)).trim().split('\n').slice(-3).join('\n') };
      }
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

  /** Each thread in the manifest (not those being removed): its name, as
   *  the sidebar shows it, its project and its agent. For the Usage dialog,
   *  which reads every thread without loading any. */
  async threadLabels(): Promise<Map<string, { title: string; repoPath: string; agent: string }>> {
    const manifest = await this.loadManifest();
    const labels = new Map<string, { title: string; repoPath: string; agent: string }>();
    for (const [id, entry] of Object.entries(manifest)) {
      if (entry.pendingRemoval) continue;
      labels.set(id, { title: entry.displayName || entry.branch, repoPath: entry.repoPath, agent: agentTypeOf(entry) });
    }
    return labels;
  }

  /** Look up a worktree by ID, falling back to the manifest if not in memory. */
  async getWorktreeOrManifest(id: string): Promise<WorktreeInfo | undefined> {
    const mem = this.worktrees.get(id);
    if (mem) return mem;

    const manifest = await this.loadManifest();
    const entry = manifest[id];
    if (!entry || entry.pendingRemoval) return undefined;

    const info: WorktreeInfo = {
      id,
      path: this.checkoutPath(id, entry),
      branch: entry.branch,
      repoPath: entry.repoPath,
      createdAt: entry.createdAt,
      lastActiveAt: entry.lastActiveAt,
      direct: entry.direct,
      ...(entry.noGit ? { noGit: true } : {}),
      displayName: entry.displayName ?? null,
      agentType: agentTypeOf(entry),
      ...linksOf(entry),
    };

    // Cache in memory for subsequent lookups
    this.setWorktree(info);
    return info;
  }

  /** Register a worktree discovered on disk (e.g. surviving a restart) into the internal map so it can be destroyed later. */
  register(info: WorktreeInfo): void {
    if (!this.worktrees.has(info.id)) {
      this.setWorktree(info);
    }
  }

  /** Put a worktree in the in-memory map, and wake what waits for it
   *  (whenRegistered). Every worktree goes in through here. */
  private setWorktree(info: WorktreeInfo): void {
    this.worktrees.set(info.id, info);
    const waiting = this.registrationWaiters.get(info.id);
    if (!waiting) return;
    this.registrationWaiters.delete(info.id);
    for (const wake of waiting) wake(info);
  }

  /** The worktree once it's registered (a new thread's, still being made),
   *  or undefined if `signal` fires first. */
  whenRegistered(id: string, signal: AbortSignal): Promise<WorktreeInfo | undefined> {
    const known = this.worktrees.get(id);
    if (known) return Promise.resolve(known);
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const wake = (info: WorktreeInfo) => {
        signal.removeEventListener('abort', stop);
        resolve(info);
      };
      const stop = () => {
        const waiting = this.registrationWaiters.get(id);
        waiting?.delete(wake);
        if (waiting?.size === 0) this.registrationWaiters.delete(id);
        resolve(undefined);
      };
      let waiting = this.registrationWaiters.get(id);
      if (!waiting) {
        waiting = new Set();
        this.registrationWaiters.set(id, waiting);
      }
      waiting.add(wake);
      signal.addEventListener('abort', stop, { once: true });
    });
  }

  /** Move a worktree folder into REMOVING_DIR of the folder that holds it
   *  (<root>/<hash>/<id>), to be deleted in the background, under a name
   *  no longer than <hash>/<id> was (removingName). Null when it can't be
   *  moved (a file in it is held open, or it isn't there): remove() then
   *  deletes it in place, as it did before. */
  private async moveAside(wtPath: string, now = Date.now()): Promise<string | null> {
    const dir = path.join(rootOf(wtPath), REMOVING_DIR);
    const dest = path.join(dir, removingName(path.basename(wtPath), now));
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.rename(wtPath, dest);
        return dest;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        // A background delete that just emptied REMOVING_DIR may have
        // removed it between the mkdir and the rename: make it again.
        if (code === 'ENOENT' && attempt === 1 && (await pathExists(wtPath))) continue;
        if (code !== 'ENOENT') logger.info(`Could not move ${wtPath} aside (${code ?? String(e)}); deleting it in place`);
        return null;
      }
    }
  }

  /** Delete a folder remove() moved aside (in the delete thread, one folder
   *  at a time), then drop its manifest entry, and REMOVING_DIR and the
   *  project's folder of worktrees if they are now empty. A delete that
   *  fails (a file still held open) leaves the entry for the sweep. */
  private finishRemoval(id: string, movedPath: string, hashDir: string): Promise<void> {
    const done = (async () => {
      try {
        await removeTree(movedPath);
      } catch (e) {
        logger.warn(`Could not delete ${movedPath} yet; the sweep will retry: ${String(e)}`);
        return;
      }
      // Only the entry for this folder: removed again meanwhile, it is gone.
      await this.withManifest((manifest) => {
        const entry = manifest[id];
        if (entry?.removingPath !== movedPath) return;
        // Its branch still waits on a prune that failed, or a linked
        // worktree on its removal: the sweep does the rest.
        if (entry.pendingBranchDelete || entry.linked?.length) delete entry.removingPath;
        else delete manifest[id];
      });
      await removeIfEmpty(path.dirname(movedPath));
      await this.removeEmptyHashDir(hashDir);
      logger.info(`Deleted the files of removed worktree ${id}`);
    })().finally(() => this.finishing.delete(id));
    this.finishing.set(id, done);
    return done;
  }

  /** Delete what is in REMOVING_DIR with no manifest entry: moved there by a
   *  remove() that stopped before it saved where (a quit or crash in
   *  between). Only names moveAside gives (removingName), moved there at
   *  least REMOVING_GRACE_MS ago: a remove() may be about to record a newer
   *  one, and Settings > Git's folder is the user's, so a .removing there
   *  may hold folders of their own. Returns how many. */
  async purgeRemoving(now = Date.now()): Promise<number> {
    const manifest = await this.loadManifest().catch((): ReadonlyManifest => ({}));
    const recorded = new Set(Object.values(manifest).flatMap((e) => (e.removingPath ? [pathKey(e.removingPath)] : [])));
    let purged = 0;
    for (const root of this.worktreeRoots(manifest)) {
      const dir = path.join(root, REMOVING_DIR);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const folder = path.join(dir, name);
        const movedAt = removingNameTime(name, now);
        if (movedAt === null || now - movedAt < REMOVING_GRACE_MS || recorded.has(pathKey(folder))) continue;
        try {
          await removeTree(folder);
          purged++;
        } catch (e) {
          logger.warn(`Could not delete ${folder}, will retry: ${String(e)}`);
        }
      }
      await removeIfEmpty(dir);
    }
    return purged;
  }

  /** Resolves once every background delete started so far has finished. */
  async backgroundRemovalsDone(): Promise<void> {
    await Promise.all(this.finishing.values());
  }

  /**
   * Move a worktree folder the app can't account for into the trash instead
   * of deleting it. Such a folder may still hold uncommitted work: a lost or
   * deleted manifest makes every folder look unknown. purgeTrash() deletes
   * it once TRASH_RETENTION_MS has passed. Throws when the folder is locked,
   * like a deletion would, so the sweep retries next time.
   */
  private async moveToTrash(dirPath: string, now = Date.now()): Promise<string> {
    // The trash of the folder the worktree is in (<root>/<hash>/<id>), so
    // the move stays on its drive and is a rename.
    const trash = path.join(rootOf(dirPath), TRASH_DIR);
    await fs.mkdir(trash, { recursive: true });
    const dest = path.join(trash, `${now}-${path.basename(path.dirname(dirPath))}-${path.basename(dirPath)}`);
    await fs.rename(dirPath, dest);
    logger.warn(`Moved unaccounted-for worktree folder ${dirPath} to ${dest}; it will be deleted after ${TRASH_RETENTION_MS / 86_400_000} days`);
    return dest;
  }

  /** Delete trashed folders older than TRASH_RETENTION_MS, from the trash
   *  of every folder that holds worktrees. Returns how many. */
  async purgeTrash(now = Date.now()): Promise<number> {
    // A manifest that can't be read still leaves the data folder's trash.
    const manifest = await this.loadManifest().catch((): ReadonlyManifest => ({}));
    let purged = 0;
    for (const root of this.worktreeRoots(manifest)) {
      const trash = path.join(root, TRASH_DIR);
      let names: string[];
      try {
        names = await fs.readdir(trash);
      } catch {
        continue;
      }
      for (const name of names) {
        const match = TRASH_NAME.exec(name);
        if (!match || now - Number(match[1]) < TRASH_RETENTION_MS) continue;
        try {
          await removeTree(path.join(trash, name));
          purged++;
        } catch (e) {
          logger.warn(`Could not purge ${name} from the worktree trash, will retry: ${e}`);
        }
      }
    }
    return purged;
  }

  /** Put a linked worktree the sweep can't account for in the trash, kept
   *  a while as an orphaned thread's is, and let its project's git forget
   *  it. */
  private async trashLink(link: Readonly<LinkedCheckout>): Promise<void> {
    await this.withRepoLock(link.repoPath, async () => {
      if (await pathExists(link.path)) await this.moveToTrash(link.path);
      await this.unlockWorktree(link.repoPath, link.path);
      try { await git(['worktree', 'prune'], link.repoPath); } catch { /* the project may be gone */ }
    });
  }

  /**
   * Drop linked worktrees that are gone: the folder deleted, or no longer a
   * worktree its project's git lists (a folder still there goes to the
   * trash). A project git can't read right now (moved, or on a drive that
   * isn't connected) is left for the next sweep. Returns how many.
   */
  async cleanupOrphanLinks(): Promise<number> {
    const manifest = await this.loadManifest();
    const listed = new Map<string, Set<string> | null>();
    const gitPathsOf = async (repoPath: string): Promise<Set<string> | null> => {
      if (!listed.has(repoPath)) {
        const output = await git(['worktree', 'list', '--porcelain'], repoPath).catch(() => null);
        listed.set(repoPath, output === null ? null : new Set(output.split('\n')
          .filter((l) => l.startsWith('worktree '))
          .map((l) => pathKey(l.slice('worktree '.length)))));
      }
      return listed.get(repoPath) ?? null;
    };
    const dropped = new Map<string, Set<string>>();
    for (const [id, entry] of Object.entries(manifest)) {
      if (entry.pendingRemoval) continue;
      for (const link of entry.linked ?? []) {
        if (link.pendingRemoval) continue;
        const gitPaths = await gitPathsOf(link.repoPath);
        if (!gitPaths) continue;
        const there = await pathExists(link.path);
        if (there && gitPaths.has(pathKey(link.path))) continue;
        // On a drive that isn't connected: not gone, only away. As
        // cleanupOrphans leaves a thread's own worktree there.
        if (!there && await this.linkOutOfReach(link)) continue;
        logger.warn(`Found orphan linked worktree of ${id}: ${link.path}`);
        try {
          await this.trashLink(link);
        } catch (e) {
          logger.error(`Failed to move orphan linked worktree ${link.path} to the trash:`, e);
          continue;
        }
        if (!dropped.has(id)) dropped.set(id, new Set());
        dropped.get(id)!.add(pathKey(link.path));
      }
    }
    if (dropped.size === 0) return 0;
    for (const [id, paths] of dropped) {
      const live = this.worktrees.get(id);
      if (!live) continue;
      const kept = (live.linked ?? []).filter((l) => !paths.has(pathKey(l.path)));
      if (kept.length > 0) live.linked = kept;
      else delete live.linked;
    }
    return this.withManifest((m) => {
      let count = 0;
      for (const [id, paths] of dropped) {
        const entry = m[id];
        if (!entry?.linked) continue;
        const kept = entry.linked.filter((l) => !paths.has(pathKey(l.path)));
        count += entry.linked.length - kept.length;
        if (kept.length > 0) entry.linked = kept;
        else delete entry.linked;
      }
      return count;
    }, (count) => count > 0);
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

    // The folders are checked first and the orphans dropped together after,
    // so no other change to the manifest waits on this I/O.
    const orphans: string[] = [];
    const hashDirs = new Set<string>();
    for (const [id, entry] of Object.entries(await this.loadManifest())) {
      if (entry.repoPath !== repoPath) continue;
      if (entry.direct) continue; // Direct sessions have no worktree to clean up
      if (entry.pendingRemoval) continue; // handled by processPendingRemovals

      const wtPath = this.checkoutPath(id, entry);

      let dirExists = true;
      try {
        await fs.access(wtPath);
      } catch (e) {
        // Only a missing directory is an orphan. Any other error (a lock,
        // permissions) says nothing about it: leave the entry for next time.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue;
        // Nor does a worktree folder that isn't there (a drive not
        // connected yet). Its worktrees are locked, so prune leaves them.
        if (entry.path && !(await pathExists(rootOf(wtPath)))) continue;
        dirExists = false;
      }

      const gitKnows = gitPaths.has(pathKey(wtPath));

      if (!dirExists || !gitKnows) {
        logger.warn(`Found orphan worktree: ${id} (dir=${dirExists}, git=${gitKnows})`);
        // Its linked projects' worktrees go with it, to the trash too: they
        // may hold work. One on a drive that isn't connected keeps the
        // entry for the next sweep, or git would lose its lock on it.
        let away = false;
        for (const link of entry.linked ?? []) {
          if (!(await pathExists(link.path)) && await this.linkOutOfReach(link)) away = true;
        }
        if (away) {
          logger.info(`Orphan ${id} has a linked worktree on a drive that isn't connected; will retry next sweep`);
          continue;
        }
        try {
          for (const link of entry.linked ?? []) await this.trashLink(link);
        } catch (e) {
          logger.error(`Failed to move orphan ${id}'s linked worktrees to the trash:`, e);
          continue; // keep the entry; retry next sweep
        }
        if (dirExists) {
          // git no longer lists it, but the folder may still hold work.
          try {
            await this.moveToTrash(wtPath);
          } catch (e) {
            logger.error(`Failed to move orphan ${wtPath} to the trash:`, e);
            continue; // keep the entry; retry next sweep
          }
        }
        // Deleted while its folder is there: unlocked, so prune clears it.
        if (!dirExists) await this.unlockWorktree(repoPath, wtPath);
        orphans.push(id);
        hashDirs.add(path.dirname(wtPath));
      }
    }

    const cleaned = await this.withManifest((manifest) => {
      let count = 0;
      for (const id of orphans) {
        // Removed meanwhile, or being removed (processPendingRemovals' now).
        if (!manifest[id] || manifest[id].pendingRemoval) continue;
        delete manifest[id];
        count++;
        logger.info(`Cleaned orphan: ${id}`);
      }
      return count;
    }, (count) => count > 0);

    if (cleaned > 0) {
      try {
        await git(['worktree', 'prune'], repoPath);
      } catch { /* ignore */ }

      // Clean up empty repoHash directories
      for (const hashDir of hashDirs) await this.removeEmptyHashDir(hashDir);
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
    await this.purgeRemoving();

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

    // Phase 1b: linked projects' worktrees that are gone.
    try {
      totalCleaned += await this.cleanupOrphanLinks();
    } catch (e) {
      logger.warn('Sweep: failed to clean orphan linked worktrees:', e);
    }

    // Phase 2: scan for directories on disk that aren't tracked in the manifest at all.
    // Only in the data folder. Settings > Git's folder is the user's: it may
    // hold their own folders, or another Windows account's worktrees that this
    // manifest doesn't list. There only the manifest says what is Grove's
    // (phase 1).
    const activeIds = new Set([...this.worktrees.keys(), ...this.creating]);
    const freshManifest = await this.loadManifest(); // re-read after phase 1 mutations

    try {
      const hashDirs = await fs.readdir(root);
      for (const hashDir of hashDirs) {
        // .removing holds folders being deleted, each in the manifest
        // (removingPath): not project folders, and not orphans to trash.
        if (hashDir === MANIFEST_FILE || hashDir === TRASH_DIR || hashDir === REMOVING_DIR) continue;
        const hashDirPath = path.join(root, hashDir);
        const stat = await fs.stat(hashDirPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const entries = await fs.readdir(hashDirPath);
        for (const entry of entries) {
          if (entry === CONFIG_FILE) continue;
          const entryPath = path.join(hashDirPath, entry);
          if (entry === LEGACY_NPM_CACHE_DIR) {
            // Installs use the user's own cache now.
            try {
              await removeDirectory(entryPath);
              logger.info(`Sweep: deleted the old npm cache ${entryPath}`);
            } catch (e) {
              logger.warn(`Sweep: could not delete the old npm cache ${entryPath}, will retry: ${e}`);
            }
            continue;
          }
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
            } catch {
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

    // Phase 3: clean stale direct entries whose project folder is gone. Only
    // the folder counts, not whether git opens it: a missing or broken git at
    // launch must not delete conversations, and a folder project has no
    // repository to check. Checked first and dropped together, as in
    // cleanupOrphans.
    const goneDirect: string[] = [];
    for (const [id, entry] of Object.entries(await this.loadManifest())) {
      if (!entry.direct) continue;
      if (activeIds.has(id)) continue;
      const valid = await fs.stat(entry.repoPath).then((st) => st.isDirectory(), () => false);
      if (!valid) goneDirect.push(id);
    }
    totalCleaned += await this.withManifest((m) => {
      let count = 0;
      for (const id of goneDirect) {
        const entry = m[id];
        if (!entry?.direct) continue; // removed meanwhile
        logger.info(`Sweep: removing stale direct entry ${id} (repo gone: ${entry.repoPath})`);
        delete m[id];
        count++;
      }
      return count;
    }, (count) => count > 0);

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
   * Find node_modules in a sibling worktree for the same repo.
   * Returns the path to node_modules if found, or null.
   */
  async findSiblingNodeModules(repoPath: string, excludeId: string): Promise<string | null> {
    const hash = this.repoHash(repoPath);
    const repoDir = path.join(this.getWorktreeRoot(), hash);

    try {
      const entries = await fs.readdir(repoDir);
      for (const entry of entries) {
        if (entry === CONFIG_FILE || entry === LEGACY_NPM_CACHE_DIR || entry === excludeId) continue;
        const nmPath = path.join(repoDir, entry, 'node_modules');
        try {
          const stat = await fs.stat(nmPath);
          if (stat.isDirectory()) return nmPath;
        } catch { /* doesn't exist */ }
      }
    } catch { /* repoDir doesn't exist yet */ }

    return null;
  }

  /** Write the files an agent needs in a worktree (Claude Code's local
   *  settings, say), for a conversation switched to that agent. */
  async writeAgentSettings(wtPath: string, repoPath: string, adapterType: string): Promise<void> {
    await this.generateAdapterSettings(wtPath, repoPath, adapterType);
  }

  private async generateAdapterSettings(wtPath: string, repoPath: string, adapterType?: string): Promise<void> {
    const adapter = adapterType ? adapterRegistry.get(adapterType) : adapterRegistry.getDefault();
    if (!adapter) {
      // Another agent's files would be wrong here, and its thread can't start anyway.
      logger.warn(`[WorktreeManager] Agent "${adapterType}" isn't registered, so no agent settings are written`);
    } else if (adapter.generateWorktreeSettings) {
      await adapter.generateWorktreeSettings(wtPath, repoPath);
    } else {
      logger.debug(`[WorktreeManager] Adapter "${adapter.id}" has no worktree settings to generate`);
    }
    // Grove's own files, not the user's: keep them out of Changes and commits.
    if (adapter?.generatedFiles?.length) {
      try {
        await excludeFromGit(wtPath, adapter.generatedFiles);
      } catch (err) {
        logger.warn(`[WorktreeManager] Could not add ${adapter.generatedFiles.join(', ')} to git's exclude list:`, err);
      }
    }
  }
}

export const worktreeManager = new WorktreeManager(() => getSettings().worktreeFolder);
