/**
 * Checkpoints against real git: capture, rewind and the index-copy snapshot,
 * in a linked worktree as the app uses them. The unit tests in
 * checkpoints.test.ts script git; these check what git actually does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from './logger.js';
import { CheckpointManager } from './checkpoints.js';

// Real git is slow to start on Windows, and each test runs a dozen commands.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let tmp: string;
let wt: string;

const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env },
  }).trim();
/** A new repo whose own config has an identity and no line-ending
 *  conversion: a CI machine has no identity, and Git for Windows turns on
 *  autocrlf, which would change what a rewind writes back. */
const initRepo = (dir: string) => {
  run(['init', '-q', '-b', 'main'], dir);
  run(['config', 'user.name', 't'], dir);
  run(['config', 'user.email', 't@t'], dir);
  run(['config', 'core.autocrlf', 'false'], dir);
};
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
  fs.writeFileSync(path.join(wt, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(wt, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(wt, rel));

beforeEach(() => {
  vi.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ckpt-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  initRepo(repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'one\n');
  run(['add', '.'], repo);
  run(['commit', '-qm', 'init'], repo);
  wt = path.join(tmp, 'wt');
  run(['worktree', 'add', '-q', '-b', 'feat', wt], repo);
});

afterEach(() => {
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('checkpoints with real git', () => {
  it('snapshots from the worktree index the same tree read-tree HEAD gives', async () => {
    write('a.ts', 'two\n');
    write('src/new.ts', 'new\n');
    write('debug.log', 'ignored\n');
    const mgr = new CheckpointManager();

    expect(await mgr.capture('s1', wt, 'u1')).toBe(true);

    const captured = run(['rev-parse', 'refs/grove/checkpoints/s1/turn/1^{tree}'], wt);
    const idx = path.join(tmp, 'ref-index');
    const env = { GIT_INDEX_FILE: idx };
    run(['read-tree', 'HEAD'], wt, env);
    run(['add', '-A'], wt, env);
    expect(captured).toBe(run(['write-tree'], wt, env));
    // It really took the fast path, not the fallback.
    expect(vi.mocked(logger.debug).mock.calls.some(([m]) => String(m).includes('reading HEAD instead'))).toBe(false);
    // And left the real index alone: nothing staged.
    expect(run(['diff', '--cached', '--name-only'], wt)).toBe('');
  });

  it('rewinds edits, deletions and new files, leaving ignored files alone', async () => {
    write('a.ts', 'two\n');
    write('keep.ts', 'untracked at the checkpoint\n');
    write('debug.log', 'ignored\n');
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');

    // What a turn might do afterwards.
    write('a.ts', 'three\n');
    fs.rmSync(path.join(wt, 'keep.ts'));
    write('src/added.ts', 'added later\n');
    write('debug.log', 'ignored, changed\n');
    await mgr.capture('s1', wt, 'u2');

    await mgr.restore('s1', wt, 'u1');

    expect(read('a.ts')).toBe('two\n');
    expect(read('keep.ts')).toBe('untracked at the checkpoint\n');
    expect(exists('src/added.ts')).toBe(false);
    expect(read('debug.log')).toBe('ignored, changed\n');
    // Nothing left staged.
    expect(run(['diff', '--cached', '--name-only'], wt)).toBe('');
  });

  it('captures on a branch with no commits yet', async () => {
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    initRepo(empty);
    fs.writeFileSync(path.join(empty, 'first.ts'), 'x\n');

    const mgr = new CheckpointManager();
    expect(await mgr.capture('s2', empty, 'u1')).toBe(true);
    expect(run(['ls-tree', '--name-only', 'refs/grove/checkpoints/s2/turn/1'], empty)).toBe('first.ts');
  });
});
