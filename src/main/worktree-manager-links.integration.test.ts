/**
 * Linked projects (docs/linked-projects-plan.md) against real git: a
 * thread's worktree of a second project on the same branch name, renamed
 * with the thread's branch, removed with the thread, and tidied by the
 * sweep when it or the thread is gone.
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
let repoA: string;
let repoB: string;
let root: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const hash = (repo: string) => crypto.createHash('sha256').update(repo).digest('hex').slice(0, 8);
const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const worktreesOf = (repo: string) => git(repo, 'worktree', 'list', '--porcelain');

function makeRepo(name: string): string {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  return repo;
}

/** A thread in A on `branch`, linked to B. */
async function linkedThread(manager: WorktreeManager, branch = 'feat', link: { useExisting?: boolean } = {}) {
  const thread = await manager.create({ repoPath: repoA, branchName: branch, id: ID });
  const linked = await manager.createLink(ID, { repoPath: repoB, branchName: branch, useExisting: link.useExisting });
  return { thread, linked };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-links-')));
  const userData = path.join(tmp, 'userData');
  root = path.join(userData, 'worktrees');
  vi.mocked(app.getPath).mockImplementation((name: string) => (name === 'userData' ? userData : path.join(tmp, name)));
  repoA = makeRepo('a');
  repoB = makeRepo('b');
});

afterEach(() => {
  vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('WorktreeManager.createLink, with real git', () => {
  it("makes a worktree of the other project on the thread's branch, named after the thread", async () => {
    const manager = new WorktreeManager();
    const { thread, linked } = await linkedThread(manager);

    expect(linked).toEqual({ repoPath: repoB, path: path.join(root, hash(repoB), ID), branch: 'feat' });
    expect(git(linked.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat');
    expect(thread.linked).toEqual([linked]);
    expect(readManifest()[ID].linked).toEqual([expect.objectContaining({ ...linked, createdBranch: true })]);
    // A manager that reads it back (an app restart) lists it with the thread.
    expect((await new WorktreeManager().getWorktreeOrManifest(ID))?.linked).toEqual([linked]);
    expect((await new WorktreeManager().list(repoA))[0].linked).toEqual([linked]);
  });

  it('continues a branch the other project has, without counting it as made by Grove', async () => {
    git(repoB, 'branch', 'feat');
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager, 'feat', { useExisting: true });
    expect(git(linked.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat');
    expect(readManifest()[ID].linked).toEqual([expect.not.objectContaining({ createdBranch: true })]);
  });

  it("refuses the thread's own project, and the same project twice", async () => {
    const manager = new WorktreeManager();
    await linkedThread(manager);
    await expect(manager.createLink(ID, { repoPath: repoA, branchName: 'feat' })).rejects.toThrow("can't link its own project");
    await expect(manager.createLink(ID, { repoPath: repoB, branchName: 'feat' })).rejects.toThrow('already works in b');
  });

  it('names the threads that work in a project', async () => {
    const manager = new WorktreeManager();
    await linkedThread(manager);
    expect(await manager.threadsLinking(repoB)).toEqual(['feat']);
    expect(await manager.threadsLinking(repoA)).toEqual([]);
  });
});

describe('WorktreeManager.renameBranch with a linked project', () => {
  it('renames the branch in both projects', async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager, 'grove/a1b2c3d4');

    await manager.renameBranch(ID, 'fix-login');

    expect(git(repoA, 'branch', '--list', 'fix-login')).toContain('fix-login');
    expect(git(linked.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('fix-login');
    expect(manager.getWorktree(ID)?.linked?.[0].branch).toBe('fix-login');
    expect((readManifest()[ID].linked as Array<{ branch: string }>)[0].branch).toBe('fix-login');
  });

  it('renames neither when the name is taken in the linked project', async () => {
    git(repoB, 'branch', 'fix-login');
    const manager = new WorktreeManager();
    const { thread, linked } = await linkedThread(manager, 'grove/a1b2c3d4');

    await expect(manager.renameBranch(ID, 'fix-login')).rejects.toThrow('already exists in b');

    expect(git(thread.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('grove/a1b2c3d4');
    expect(git(linked.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('grove/a1b2c3d4');
  });
});

describe('WorktreeManager.remove with a linked project', () => {
  it("removes the linked worktree too, and the branch Grove made there when asked", async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    git(linked.path, 'commit', '-q', '--allow-empty', '-m', 'work in b');

    await manager.remove(ID, true);

    expect(fs.existsSync(linked.path)).toBe(false);
    expect(worktreesOf(repoB)).not.toContain(ID);
    expect(git(repoB, 'branch', '--list', 'feat')).toBe('');
    await vi.waitFor(() => expect(readManifest()[ID]).toBeUndefined());
  });

  it('keeps the linked branch when not asked to delete it', async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    git(linked.path, 'commit', '-q', '--allow-empty', '-m', 'work in b');

    await manager.remove(ID, false);

    expect(worktreesOf(repoB)).not.toContain(ID);
    expect(git(repoB, 'log', '-1', '--format=%s', 'feat')).toBe('work in b');
  });

  it("keeps unmerged work on a linked branch Grove didn't make", async () => {
    git(repoB, 'branch', 'feat');
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager, 'feat', { useExisting: true });
    git(linked.path, 'commit', '-q', '--allow-empty', '-m', 'work in b');

    await manager.remove(ID, true);

    expect(git(repoB, 'log', '-1', '--format=%s', 'feat')).toBe('work in b');
  });
});

describe('WorktreeManager.unlinkProject', () => {
  it('removes the linked worktree and its branch when asked, and keeps the thread', async () => {
    const manager = new WorktreeManager();
    const { thread, linked } = await linkedThread(manager);

    expect(await manager.unlinkProject(ID, repoB, true)).toEqual(linked);

    expect(fs.existsSync(linked.path)).toBe(false);
    expect(worktreesOf(repoB)).not.toContain(ID);
    expect(git(repoB, 'branch', '--list', 'feat')).toBe('');
    expect(readManifest()[ID]).not.toHaveProperty('linked');
    expect(manager.getWorktree(ID)?.linked).toBeUndefined();
    // The thread's own worktree stays.
    expect(fs.existsSync(thread.path)).toBe(true);
  });

  it("keeps the branch unless asked, and refuses a project the thread doesn't link", async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    git(linked.path, 'commit', '-q', '--allow-empty', '-m', 'work in b');

    await manager.unlinkProject(ID, repoB, false);
    expect(git(repoB, 'log', '-1', '--format=%s', 'feat')).toBe('work in b');
    await expect(manager.unlinkProject(ID, repoB, false)).rejects.toThrow("doesn't work in b");
  });

  it('can link the same project again afterwards', async () => {
    const manager = new WorktreeManager();
    await linkedThread(manager);
    await manager.unlinkProject(ID, repoB, false);
    const again = await manager.createLink(ID, { repoPath: repoB, branchName: 'feat', useExisting: true });
    expect(git(again.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat');
  });
});

describe('a linked worktree that cannot be removed at once', () => {
  it('keeps the thread hidden until the sweep finishes it, branch and all', async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    // B's git can't be read while the thread is deleted.
    fs.renameSync(path.join(repoB, '.git'), path.join(repoB, '.git-off'));

    await manager.remove(ID, true);

    await vi.waitFor(() => expect(readManifest()[ID]).toMatchObject({
      pendingRemoval: true,
      linked: [expect.objectContaining({ path: linked.path, pendingRemoval: true, pendingBranchDelete: true })],
    }));
    expect(await new WorktreeManager().getWorktreeOrManifest(ID)).toBeUndefined();
    // The thread's own folder is deleted in the background meanwhile.
    await vi.waitFor(() => expect(readManifest()[ID].removingPath).toBeUndefined());

    fs.renameSync(path.join(repoB, '.git-off'), path.join(repoB, '.git'));
    expect(await manager.processPendingRemovals()).toBe(1);

    expect(readManifest()[ID]).toBeUndefined();
    expect(worktreesOf(repoB)).not.toContain(ID);
    expect(git(repoB, 'branch', '--list', 'feat')).toBe('');
  });
});

describe('the sweep with linked projects', () => {
  it('drops a linked worktree whose folder is gone, and frees its branch', async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    fs.rmSync(linked.path, { recursive: true, force: true });

    expect(await manager.cleanupOrphanLinks()).toBe(1);

    expect(readManifest()[ID].linked).toBeUndefined();
    expect(manager.getWorktree(ID)?.linked).toBeUndefined();
    expect(worktreesOf(repoB)).not.toContain(ID);
    // The branch can be checked out again.
    git(repoB, 'switch', '-q', 'feat');
  });

  it('keeps a linked worktree that is there', async () => {
    const manager = new WorktreeManager();
    await linkedThread(manager);
    expect(await manager.cleanupOrphanLinks()).toBe(0);
    expect(readManifest()[ID].linked).toHaveLength(1);
  });

  it("puts an orphaned thread's linked worktree in the trash with it", async () => {
    const manager = new WorktreeManager();
    const { thread, linked } = await linkedThread(manager);
    fs.rmSync(thread.path, { recursive: true, force: true });

    expect(await manager.cleanupOrphans(repoA)).toBe(1);

    expect(readManifest()[ID]).toBeUndefined();
    expect(fs.existsSync(linked.path)).toBe(false);
    expect(fs.readdirSync(path.join(root, '.trash')).some((name) => name.endsWith(`${hash(repoB)}-${ID}`))).toBe(true);
    expect(worktreesOf(repoB)).not.toContain(ID);
  });

  it("keeps the linked worktree's folder through the unknown-folder scan", async () => {
    const manager = new WorktreeManager();
    const { linked } = await linkedThread(manager);
    await manager.sweepStaleWorktrees();
    expect(fs.existsSync(linked.path)).toBe(true);
    expect(readManifest()[ID].linked).toHaveLength(1);
  });
});
