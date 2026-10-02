/**
 * git.ts helpers against real git, for behaviour that depends on history
 * shape. git.test.ts covers the same functions with scripted output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveMergeBase, squashSince, branchCommits, excludeFromGit } from './git.js';

// Real git is slow to start on Windows, and each test runs a dozen commands.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: string;

const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const commit = (file: string, message: string) => {
  fs.writeFileSync(path.join(repo, file), `${message}\n`);
  run('add', file);
  run('commit', '-qm', message);
  return run('rev-parse', 'HEAD');
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-git-'));
  run('init', '-q', '-b', 'main');
  // In the repo's own config, so the app's git calls see them too: a CI
  // machine has no identity, and Git for Windows turns on autocrlf.
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  run('config', 'core.autocrlf', 'false');
  commit('base.txt', 'base');
});

afterEach(() => {
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/**
 * origin/main is two commits ahead of local main (someone pushed; local was
 * never fast-forwarded), and the conversation's branch started from
 * origin/main, as a new worktree does when local main can't be moved.
 */
function staleLocalBase() {
  run('checkout', '-q', '-b', 'upstream');
  commit('up1.txt', 'upstream 1');
  const originMain = commit('up2.txt', 'upstream 2');
  run('update-ref', 'refs/remotes/origin/main', originMain);
  run('checkout', '-q', '-b', 'grove/feat', originMain);
  commit('m1.txt', 'mine 1');
  commit('m2.txt', 'mine 2');
  return originMain;
}

describe('a local base behind origin', () => {
  it('resolveMergeBase uses origin/<base>', async () => {
    const originMain = staleLocalBase();
    expect(await resolveMergeBase(repo, 'main')).toEqual({ ref: 'origin/main', mergeBase: originMain });
  });

  it('squash folds in only the branch\'s own commits', async () => {
    const originMain = staleLocalBase();

    expect(await squashSince(repo, 'main', 'Mine, squashed')).toEqual({ success: true });

    expect(run('rev-parse', 'HEAD~1')).toBe(originMain);
    expect(run('log', '--format=%s', `${originMain}..HEAD`)).toBe('Mine, squashed');
    expect(run('diff', '--name-only', 'HEAD~1', 'HEAD').split('\n')).toEqual(['m1.txt', 'm2.txt']);
  });

  it('branchCommits lists only the branch\'s own commits', async () => {
    staleLocalBase();
    expect((await branchCommits(repo, 'main')).map((c) => c.subject)).toEqual(['mine 2', 'mine 1']);
  });
});

describe('squash', () => {
  it('puts the branch back when the commit is rejected', async () => {
    commit('m1.txt', 'mine 1');
    commit('m2.txt', 'mine 2');
    const before = run('rev-parse', 'HEAD');
    // A commit-msg hook that rejects every message, like a failing commitlint.
    const hook = path.join(repo, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(hook, '#!/bin/sh\necho "rejected by hook" >&2\nexit 1\n', { mode: 0o755 });

    const result = await squashSince(repo, 'HEAD~2', 'Squashed');

    expect(result.success).toBe(false);
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect(run('status', '--porcelain')).toBe('');
  });
});

describe('a local base ahead of origin', () => {
  it('keeps the local base', async () => {
    const originMain = run('rev-parse', 'HEAD');
    run('update-ref', 'refs/remotes/origin/main', originMain);
    const localMain = commit('local.txt', 'local only');
    run('checkout', '-q', '-b', 'grove/feat');
    commit('m1.txt', 'mine 1');

    expect(await resolveMergeBase(repo, 'main')).toEqual({ ref: 'main', mergeBase: localMain });
  });
});

describe("Grove's own files in a worktree", () => {
  const SETTINGS = '.claude/settings.local.json';
  let wt: string;

  beforeEach(() => {
    wt = `${repo}-wt`;
    run('worktree', 'add', '-q', '-b', 'feat', wt);
    fs.mkdirSync(path.join(wt, '.claude'));
    fs.writeFileSync(path.join(wt, SETTINGS), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const wtStatus = () => execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim();

  it('are kept out of status and git add -A, through the shared exclude file', async () => {
    expect(wtStatus()).toContain('.claude/');
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([SETTINGS]);
    expect(wtStatus()).toBe('');
    execFileSync('git', ['add', '-A'], { cwd: wt });
    expect(wtStatus()).toBe('');
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.claude/settings.local.json');
  });

  it('are added once, however many worktrees ask', async () => {
    await excludeFromGit(wt, [SETTINGS]);
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
    const lines = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(lines.filter((l) => l === '/.claude/settings.local.json')).toHaveLength(1);
  });

  it('are left alone when the project already ignores them', async () => {
    fs.writeFileSync(path.join(wt, '.gitignore'), '.claude/settings.local.json\n');
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
  });

  it('are left alone when the project tracks them', async () => {
    execFileSync('git', ['add', SETTINGS], { cwd: wt });
    execFileSync('git', ['commit', '-qm', 'track settings'], { cwd: wt });
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
  });
});
