import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { planMergeInto, mergeInto } from './git.js';

// Real git in a temp repo: merge behaviour (conflicts, aborts, ref updates)
// is what matters here, and a mocked execa can't show it.

let root: string;
let repo: string;
let wt: string;

async function g(cwd: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout.trim();
}

async function commitFile(cwd: string, file: string, content: string, message: string): Promise<void> {
  fs.writeFileSync(path.join(cwd, file), content);
  await g(cwd, 'add', file);
  await g(cwd, 'commit', '-q', '-m', message);
}

beforeEach(async () => {
  // realpath: git reports long, resolved paths (Windows 8.3 temp names, macOS /private).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-merge-')));
  repo = path.join(root, 'repo');
  wt = path.join(root, 'wt');
  fs.mkdirSync(repo);
  await g(repo, 'init', '-q', '-b', 'main');
  await g(repo, 'config', 'user.email', 'test@example.com');
  await g(repo, 'config', 'user.name', 'Test');
  await g(repo, 'config', 'commit.gpgsign', 'false');
  await commitFile(repo, 'a.txt', 'one\n', 'initial');
  await g(repo, 'worktree', 'add', '-q', '-b', 'feat', wt, 'main');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('planMergeInto', () => {
  it('plans a merge in the project folder when it has the target checked out', async () => {
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    const plan = await planMergeInto(repo, wt, 'main');
    expect(plan).toMatchObject({ branch: 'feat', target: 'main', commits: 1, uncommitted: 0 });
    expect(plan.blocked).toBeUndefined();
    expect(path.resolve(plan.checkoutPath!)).toBe(path.resolve(repo));
  });

  it('counts uncommitted files and says to commit when there is nothing else', async () => {
    fs.writeFileSync(path.join(wt, 'a.txt'), 'changed\n');
    const plan = await planMergeInto(repo, wt, 'main');
    expect(plan.uncommitted).toBe(1);
    expect(plan.blocked).toMatch(/Commit the changes/);
  });

  it('refuses when the project folder has uncommitted changes', async () => {
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty\n');
    expect((await planMergeInto(repo, wt, 'main')).blocked).toMatch(/project folder has uncommitted changes/);
  });

  it('ignores untracked files in the project folder', async () => {
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'scratch\n');
    expect((await planMergeInto(repo, wt, 'main')).blocked).toBeUndefined();
  });

  it('refuses while the project folder is in the middle of a merge, so it never aborts the user\'s own', async () => {
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    // A merge with every conflict resolved to match HEAD: MERGE_HEAD set, nothing to stage.
    fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), (await g(repo, 'rev-parse', 'feat')) + '\n');
    expect((await planMergeInto(repo, wt, 'main')).blocked).toMatch(/in the middle of a merge/);
    expect(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
  });

  it('refuses a branch that does not exist', async () => {
    expect((await planMergeInto(repo, wt, 'nope')).blocked).toMatch(/no local branch called nope/);
  });

  it('refuses to merge a branch into itself', async () => {
    expect((await planMergeInto(repo, wt, 'feat')).blocked).toMatch(/already on feat/);
  });

  it('refuses a target checked out somewhere other than the project folder', async () => {
    const other = path.join(root, 'other');
    await g(repo, 'worktree', 'add', '-q', '-b', 'dev', other, 'main');
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    expect((await planMergeInto(repo, wt, 'dev')).blocked).toMatch(/not the project folder/);
  });

  it('allows a fast-forward of a branch no checkout has', async () => {
    await g(repo, 'branch', 'release', 'main');
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    const plan = await planMergeInto(repo, wt, 'release');
    expect(plan.checkoutPath).toBeNull();
    expect(plan.blocked).toBeUndefined();
  });

  it('refuses a branch no checkout has once it has moved on', async () => {
    await g(repo, 'branch', 'release', 'main');
    await g(repo, 'checkout', '-q', 'release');
    await commitFile(repo, 'r.txt', 'r\n', 'release only');
    await g(repo, 'checkout', '-q', 'main');
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    expect((await planMergeInto(repo, wt, 'release')).blocked).toMatch(/rebase this branch onto it/);
  });
});

describe('mergeInto', () => {
  it('merges into the project folder and leaves the conversation alone', async () => {
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    const result = await mergeInto(repo, wt, 'main');
    expect(result).toEqual({ success: true });
    expect(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8')).toBe('new\n');
    expect(await g(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat');
  });

  it('aborts on a conflict and reports the files, leaving the project folder as it was', async () => {
    await commitFile(wt, 'a.txt', 'theirs\n', 'change a in feat');
    await commitFile(repo, 'a.txt', 'ours\n', 'change a in main');
    const before = await g(repo, 'rev-parse', 'HEAD');

    const result = await mergeInto(repo, wt, 'main');

    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(['a.txt']);
    expect(await g(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(await g(repo, 'status', '--porcelain')).toBe('');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('ours\n');
  });

  it('fast-forwards a branch no checkout has', async () => {
    await g(repo, 'branch', 'release', 'main');
    await commitFile(wt, 'b.txt', 'new\n', 'add b');
    expect(await mergeInto(repo, wt, 'release')).toEqual({ success: true });
    expect(await g(repo, 'rev-parse', 'release')).toBe(await g(repo, 'rev-parse', 'feat'));
  });

  it('returns the reason instead of merging when blocked', async () => {
    const result = await mergeInto(repo, wt, 'main');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to merge/);
  });
});
