import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { git, isGitRepo, renameBranch as gitRenameBranch, branchHasRemote, validateBranchName, branchExists, getGitIdentity } from './git.js';
import { logger } from './logger.js';
import type { WorktreeConfig, WorktreeInfo, WorktreeRepoConfig } from '../shared/types.js';
import { adapterRegistry } from './adapters/index.js';
import { getSettings } from './settings.js';
import { getFilterScriptPaths } from './filters/paths.js';

const CONFIG_FILE = 'config.json';
const MANIFEST_FILE = 'manifest.json';
const NPM_CACHE_DIR = '.npm-cache';
const DEFAULT_COPY_PATTERNS = ['.env', '.env.local', '.env.development', '.npmrc', '.nvmrc'];

interface ManifestEntry {
  repoPath: string;
  branch: string;
  createdAt: number;
  providerSessionId?: string;
  /** @deprecated Use providerSessionId — kept for migration from older manifests. */
  claudeSessionId?: string;
  direct?: boolean;
}

type Manifest = Record<string, ManifestEntry>;

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
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

  private async loadManifest(): Promise<Manifest> {
    const manifestPath = path.join(this.getWorktreeRoot(), MANIFEST_FILE);
    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(data) as Manifest;
    } catch {
      return {};
    }
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    const root = this.getWorktreeRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
    );
  }

  async validateRepo(repoPath: string): Promise<boolean> {
    return isGitRepo(repoPath);
  }

  async create(config: WorktreeConfig): Promise<WorktreeInfo> {
    const { repoPath, branchName, baseBranch, useExisting } = config;

    const id = config.id ?? crypto.randomUUID().slice(0, 8);
    const hash = this.repoHash(repoPath);
    const wtPath = path.join(this.getWorktreeRoot(), hash, id);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(wtPath), { recursive: true });

    // Create worktree: existing branch or new branch
    if (useExisting) {
      await git(['worktree', 'add', wtPath, branchName], repoPath);
    } else {
      // Pull latest changes for the base branch so the worktree starts up-to-date
      if (baseBranch) {
        const hasRemote = await branchHasRemote(repoPath, baseBranch);
        if (hasRemote) {
          try {
            await git(['fetch', 'origin', `${baseBranch}:${baseBranch}`], repoPath);
          } catch {
            // fetch may fail if baseBranch is currently checked out (can't update checked-out branch
            // via fetch refspec) — fall back to fetch + merge approach
            try {
              await git(['fetch', 'origin', baseBranch], repoPath);
            } catch { /* offline or no remote — proceed with local state */ }
          }
        }
      }

      // Delete stale branch from a previous run if it exists (e.g. orch retry)
      const exists = await branchExists(repoPath, branchName);
      if (exists) {
        try {
          // Find and force-remove any worktree using this branch
          const wtList = await git(['worktree', 'list', '--porcelain'], repoPath);
          let staleWtPath: string | null = null;
          for (const block of wtList.split('\n\n')) {
            if (block.includes(`branch refs/heads/${branchName}`)) {
              const pathLine = block.split('\n').find(l => l.startsWith('worktree '));
              if (pathLine) staleWtPath = pathLine.slice('worktree '.length);
            }
          }
          if (staleWtPath) {
            await git(['worktree', 'remove', '--force', staleWtPath], repoPath).catch(() => {});
          }
          await git(['worktree', 'prune'], repoPath);
          await git(['branch', '-D', branchName], repoPath);
        } catch { /* best effort */ }
      }
      await git(['worktree', 'add', '-b', branchName, wtPath, ...(baseBranch ? [baseBranch] : [])], repoPath);
    }

    // Generate agent-specific settings (e.g. .claude/settings.local.json)
    await this.generateAdapterSettings(wtPath, config.adapterType);

    // Configure output filtering if enabled
    await this.configureOutputFiltering(wtPath, config.adapterType);

    // Propagate the repo's git identity into the worktree so commits
    // are attributed to the user rather than the agent's default identity.
    try {
      const identity = await getGitIdentity(repoPath);
      await git(['config', 'user.name', identity.name], wtPath);
      await git(['config', 'user.email', identity.email], wtPath);
    } catch { /* best effort — falls back to global config */ }

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
      };
    });

    return info;
  }

  /**
   * Register a "direct" session — runs on the repo checkout, no worktree created.
   * Still tracked in the manifest for session ID persistence.
   */
  async registerDirect(repoPath: string, branch: string): Promise<WorktreeInfo> {
    const id = crypto.randomUUID().slice(0, 8);

    const info: WorktreeInfo = {
      id,
      path: repoPath,
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

  /** Retrieve the last provider session ID for a worktree. */
  async getProviderSessionId(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    const entry = manifest[worktreeId];
    // Fall back to old claudeSessionId field for migration
    return entry?.providerSessionId ?? entry?.claudeSessionId;
  }


  async remove(id: string, deleteBranch = false): Promise<void> {
    let info = this.worktrees.get(id);

    // Fall back to manifest if not in memory (e.g. after restart)
    if (!info) {
      const manifest = await this.loadManifest();
      const entry = manifest[id];
      if (!entry) return;
      const hash = this.repoHash(entry.repoPath);
      info = {
        id,
        path: entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), hash, id),
        branch: entry.branch,
        repoPath: entry.repoPath,
        createdAt: entry.createdAt,
        direct: entry.direct,
      };
    }

    const { path: wtPath, repoPath, branch } = info;

    // Serialize git operations per-repo to prevent concurrent worktree remove conflicts
    await this.withRepoLock(repoPath, async () => {
      if (!info.direct) {
        // Retry chain for Windows file locking
        try {
          await git(['worktree', 'remove', wtPath], repoPath);
        } catch {
          try {
            await git(['worktree', 'remove', '--force', wtPath], repoPath);
          } catch {
            try {
              await fs.rm(wtPath, { recursive: true, force: true });
              await git(['worktree', 'prune'], repoPath);
            } catch (e) {
              console.warn(`Failed to clean up worktree ${id}:`, e);
            }
          }
        }
      }

      // Optionally delete branch (skip for direct sessions — it's the checked-out branch)
      if (deleteBranch && !info.direct) {
        try {
          await git(['branch', '-d', branch], repoPath);
        } catch {
          try {
            await git(['branch', '-D', branch], repoPath);
          } catch (e) {
            console.warn(`Failed to delete branch ${branch}:`, e);
          }
        }
      }

      this.worktrees.delete(id);

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
          gitWorktrees.set(path.resolve(raw), block);
        }
      }

      const hash = this.repoHash(repoPath);
      const entries: WorktreeInfo[] = [];

      // Return manifest entries for this repo that git still knows about
      for (const [id, entry] of Object.entries(manifest)) {
        if (entry.repoPath !== repoPath) continue;

        // Direct sessions don't have a worktree on disk
        if (entry.direct) {
          entries.push({
            id,
            path: repoPath,
            branch: entry.branch,
            repoPath,
            createdAt: entry.createdAt,
            direct: true,
          });
          continue;
        }

        const wtPath = path.join(this.getWorktreeRoot(), hash, id);
        const block = gitWorktrees.get(path.resolve(wtPath));
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
      repos.add(entry.repoPath);
    }
    return [...repos];
  }

  async cleanupAll(): Promise<void> {
    // Collect repo paths before removal (remove() deletes from the map)
    const repoPaths = new Set([...this.worktrees.values()].map((w) => w.repoPath));
    const ids = [...this.worktrees.keys()];
    for (const id of ids) {
      await this.remove(id, true);
    }
    // Final prune for any leftovers
    for (const repoPath of repoPaths) {
      try {
        await git(['worktree', 'prune'], repoPath);
      } catch { /* ignore */ }
    }
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
      throw new Error(`Session ${id} is not active`);
    }

    if (info.direct) {
      throw new Error('Cannot rename branch for direct sessions');
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
      if (manifest[id]) {
        manifest[id].branch = newName;
      }
    });

    return newName;
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
    if (!entry) return undefined;

    const hash = this.repoHash(entry.repoPath);
    const info: WorktreeInfo = {
      id,
      path: entry.direct ? entry.repoPath : path.join(this.getWorktreeRoot(), hash, id),
      branch: entry.branch,
      repoPath: entry.repoPath,
      createdAt: entry.createdAt,
      direct: entry.direct,
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
          gitPaths.add(path.resolve(wtPathLine.replace('worktree ', '')));
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

        const wtPath = path.join(this.getWorktreeRoot(), hash, id);

        let dirExists = false;
        try {
          await fs.access(wtPath);
          dirExists = true;
        } catch { /* doesn't exist */ }

        const gitKnows = gitPaths.has(path.resolve(wtPath));

        if (!dirExists || !gitKnows) {
          logger.warn(`Found orphan worktree: ${id} (dir=${dirExists}, git=${gitKnows})`);
          if (dirExists) {
            try {
              await fs.rm(wtPath, { recursive: true, force: true });
            } catch (e) {
              logger.error(`Failed to clean orphan ${wtPath}:`, e);
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

    const manifest = await this.loadManifest();

    // Collect unique repo paths from manifest (non-direct entries only)
    const repoPaths = new Set<string>();
    for (const entry of Object.values(manifest)) {
      if (!entry.direct) {
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
    const activeIds = new Set(this.worktrees.keys());
    const freshManifest = await this.loadManifest(); // re-read after phase 1 mutations

    try {
      const hashDirs = await fs.readdir(root);
      for (const hashDir of hashDirs) {
        if (hashDir === MANIFEST_FILE) continue;
        const hashDirPath = path.join(root, hashDir);
        const stat = await fs.stat(hashDirPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const entries = await fs.readdir(hashDirPath);
        for (const entry of entries) {
          if (entry === CONFIG_FILE || entry === NPM_CACHE_DIR) continue;
          const entryPath = path.join(hashDirPath, entry);
          const entryStat = await fs.stat(entryPath).catch(() => null);
          if (!entryStat?.isDirectory()) continue;

          // If this directory ID is not in the manifest and not an active session, remove it
          if (!freshManifest[entry] && !activeIds.has(entry)) {
            logger.warn(`Sweep: removing untracked worktree directory: ${entryPath}`);
            try {
              await fs.rm(entryPath, { recursive: true, force: true });
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

  private async generateAdapterSettings(wtPath: string, adapterType?: string): Promise<void> {
    const adapter = adapterType ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault()) : adapterRegistry.getDefault();
    if (adapter.generateWorktreeSettings) {
      await adapter.generateWorktreeSettings(wtPath);
    } else {
      logger.debug(`[WorktreeManager] Adapter "${adapter.id}" has no worktree settings to generate`);
    }
  }

  private async configureOutputFiltering(wtPath: string, adapterType?: string): Promise<void> {
    const settings = getSettings();
    if (!settings.outputFiltering) {
      logger.debug('[WorktreeManager] Output filtering disabled in settings');
      return;
    }

    const adapter = adapterType ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault()) : adapterRegistry.getDefault();
    if (!adapter.configureOutputFiltering) {
      logger.debug(`[WorktreeManager] Adapter "${adapter.id}" does not support output filtering`);
      return;
    }

    try {
      const { filterScriptPath, hookScriptPath } = getFilterScriptPaths();
      await adapter.configureOutputFiltering(wtPath, filterScriptPath, hookScriptPath);
      logger.info(`[WorktreeManager] Output filtering configured for ${wtPath}`);
    } catch (err) {
      logger.warn(`[WorktreeManager] Failed to configure output filtering: ${err}`);
    }
  }
}

export const worktreeManager = new WorktreeManager();
