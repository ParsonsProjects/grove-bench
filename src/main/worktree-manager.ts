import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { git, isGitRepo } from './git.js';
import { logger } from './logger.js';
import type { WorktreeConfig, WorktreeInfo, WorktreeRepoConfig } from '../shared/types.js';

const CONFIG_FILE = 'config.json';
const MANIFEST_FILE = 'manifest.json';
const DEFAULT_COPY_PATTERNS = ['.env', '.env.local', '.env.development', '.npmrc', '.nvmrc'];

interface ManifestEntry {
  repoPath: string;
  branch: string;
  createdAt: number;
  claudeSessionId?: string;
}

type Manifest = Record<string, ManifestEntry>;

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  private manifestLock = Promise.resolve();

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

    const id = crypto.randomUUID().slice(0, 8);
    const hash = this.repoHash(repoPath);
    const wtPath = path.join(this.getWorktreeRoot(), hash, id);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(wtPath), { recursive: true });

    // Create worktree: existing branch or new branch
    const args = useExisting
      ? ['worktree', 'add', wtPath, branchName]
      : ['worktree', 'add', '-b', branchName, wtPath, ...(baseBranch ? [baseBranch] : [])];
    await git(args, repoPath);

    // Generate .claude/settings.local.json with deny rules
    await this.generateClaudeSettings(wtPath);

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

  /** Persist the Claude SDK session ID so it can be resumed after restart. */
  async saveClaudeSessionId(worktreeId: string, claudeSessionId: string): Promise<void> {
    await this.withManifest((manifest) => {
      if (manifest[worktreeId]) {
        manifest[worktreeId].claudeSessionId = claudeSessionId;
      }
    });
  }

  /** Retrieve the last Claude SDK session ID for a worktree. */
  async getClaudeSessionId(worktreeId: string): Promise<string | undefined> {
    const manifest = await this.loadManifest();
    return manifest[worktreeId]?.claudeSessionId;
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
        path: path.join(this.getWorktreeRoot(), hash, id),
        branch: entry.branch,
        repoPath: entry.repoPath,
        createdAt: entry.createdAt,
      };
    }

    const { path: wtPath, repoPath, branch } = info;

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

    // Optionally delete branch
    if (deleteBranch) {
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

    // Clean up empty repoHash directory
    const hash = this.repoHash(repoPath);
    const repoDir = path.join(this.getWorktreeRoot(), hash);
    try {
      const entries = await fs.readdir(repoDir);
      const remaining = entries.filter((e) => e !== CONFIG_FILE);
      if (remaining.length === 0) {
        await fs.rm(repoDir, { recursive: true, force: true });
      }
    } catch { /* directory may not exist */ }
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

  getWorktree(id: string): WorktreeInfo | undefined {
    return this.worktrees.get(id);
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
        const remaining = entries.filter((e) => e !== CONFIG_FILE);
        if (remaining.length === 0) {
          await fs.rm(repoDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }

    return cleaned;
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
      const config: WorktreeRepoConfig = { copyFiles, copyDirs: [] };
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

  private async generateClaudeSettings(wtPath: string): Promise<void> {
    const claudeDir = path.join(wtPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          permissions: {
            deny: ['Read(../../**)', 'Edit(../../**)'],
          },
        },
        null,
        2
      )
    );
  }
}

export const worktreeManager = new WorktreeManager();
