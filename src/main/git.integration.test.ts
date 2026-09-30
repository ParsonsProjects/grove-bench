/**
 * git.ts helpers against real git, for behaviour that depends on history
 * shape. git.test.ts covers the same functions with scripted output.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveMergeBase, squashSince, branchCommits } from './git.js';

let repo: string;

const run = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
const commit = (file: string, message: string) => {
  fs.writeFileSync(path.join(repo, file), `${message}\n`);
  run('add', file);
  run('commit', '-qm', message);
  return run('rev-parse', 'HEAD');
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-git-'));
  run('init', '-q', '-b', 'main');
  commit('base.txt', 'base');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
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
