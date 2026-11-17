/**
 * WorktreeManager.remove against real git and a real folder: the folder is
 * moved aside, git forgets the worktree and frees its branch, and the files
 * are deleted in the background. worktree-manager.test.ts covers the same
 * paths with git and fs scripted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { app } from 'electron';

vi.mock('./adapters/index.js', () => ({
  adapterRegistry: { get: vi.fn(), getDefault: vi.fn(() => ({ generateSettings: undefined })) },
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WorktreeManager } from './worktree-manager.js';

// Real git is slow to start on Windows.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ID = 'a1b2c3d4';
let tmp: string;
let repo: string;
let root: string;
let wtPath: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const manifestPath = () => path.join(root, 'manifest.json');
const readManifest = () => JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) as Record<string, Record<string, unknown>>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-wt-')));
  repo = path.join(tmp, 'repo');
  const userData = path.join(tmp, 'userData');
  root = path.join(userData, 'worktrees');
  vi.mocked(app.getPath).mockImplementation((name: string) => (name === 'userData' ? userData : path.join(tmp, name)));

  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');

  // A thread's worktree where Grove makes them, with work on its branch
  // that main doesn't have and an install's worth of files.
  const hash = crypto.createHash('sha256').update(repo).digest('hex').slice(0, 8);
  wtPath = path.join(root, hash, ID);
  git(repo, 'worktree', 'add', '-q', '-b', 'feat-a', wtPath);
  git(wtPath, 'commit', '-q', '--allow-empty', '-m', 'work not on main');
  fs.mkdirSync(path.join(wtPath, 'node_modules', 'pkg', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(wtPath, 'node_modules', 'pkg', 'lib', 'index.js'), 'x');
  fs.writeFileSync(manifestPath(), JSON.stringify({
    [ID]: { repoPath: repo, branch: 'feat-a', createdAt: 1, createdBranches: ['feat-a'] },
  }));
});

afterEach(() => {
  vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('WorktreeManager.remove, with real git', () => {
  it('moves the folder aside, frees the branch, then deletes the files and the entry', async () => {
    const manager = new WorktreeManager();

    await manager.remove(ID, true);

    // Gone from where it was, and from git's list, at once.
    expect(fs.existsSync(wtPath)).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(ID);
    // The branch Grove made went, unmerged work and all (as asked).
    expect(git(repo, 'branch', '--list', 'feat-a')).toBe('');
    expect(readManifest()[ID]).toMatchObject({ pendingRemoval: true, removingPath: expect.stringContaining(`${ID}~`) });

    await manager.backgroundRemovalsDone();

    expect(readManifest()).toEqual({});
    // Nothing left behind: not the moved folder, .removing, or the project's folder.
    expect(fs.readdirSync(root).sort()).toEqual(['manifest.json']);
  });

  it('keeps the branch when not asked to delete it, with its commits', async () => {
    const manager = new WorktreeManager();

    await manager.remove(ID, false);
    await manager.backgroundRemovalsDone();

    expect(git(repo, 'branch', '--list', 'feat-a')).toContain('feat-a');
    expect(git(repo, 'log', '-1', '--format=%s', 'feat-a')).toBe('work not on main');
    // git no longer counts it checked out anywhere, so it can be checked out again.
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(ID);
    expect(readManifest()).toEqual({});
  });

  it('the sweep finishes a delete a quit cut short', async () => {
    const manager = new WorktreeManager();
    await manager.remove(ID, false);
    await manager.backgroundRemovalsDone();

    // As if the app had quit after the move, before the files were deleted:
    // the folder is back in .removing, and the entry still names it.
    const moved = path.join(root, '.removing', `${ID}~${Date.now().toString(36)}`);
    fs.mkdirSync(path.join(moved, 'node_modules'), { recursive: true });
    fs.writeFileSync(manifestPath(), JSON.stringify({
      [ID]: { repoPath: repo, branch: 'feat-a', createdAt: 1, pendingRemoval: true, removingPath: moved },
    }));

    const next = new WorktreeManager();
    expect(await next.processPendingRemovals()).toBe(1);
    expect(fs.existsSync(moved)).toBe(false);
    expect(readManifest()).toEqual({});
  });
});
