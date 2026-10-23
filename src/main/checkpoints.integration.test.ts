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
import { MAX_TEXT_FILE_BYTES } from './git.js';

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

  it('gives a file\'s lines after a turn for expanding context, unless it\'s over the size limit', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    write('src/notes.ts', 'one\ntwo\n\n');
    write('dist/bundle.js', 'x'.repeat(5 * 1024 * 1024));

    expect(await mgr.fileLines('s1', wt, 'u1', 'since', 'src/notes.ts')).toEqual({ lines: ['one', 'two', ''] });
    expect(await mgr.fileLines('s1', wt, 'u1', 'since', 'dist/bundle.js')).toBeNull();
  });

  it('counts the lines of a renamed file and one named outside ASCII', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    fs.renameSync(path.join(wt, 'a.ts'), path.join(wt, 'b.ts'));
    write('b.ts', 'one\ntwo\n');
    write('café.ts', 'x\n');

    const { entries } = await mgr.files('s1', wt, 'u1', 'since');

    expect(entries.map(({ filePath, additions, deletions }) => ({ filePath, additions, deletions }))).toEqual([
      { filePath: 'b.ts', additions: 1, deletions: 0 },
      { filePath: 'café.ts', additions: 1, deletions: 0 },
    ]);
  });

  it('previews a rewind too long to show as the files it changes', async () => {
    // Colour on even outside a terminal: the preview must still be plain text.
    run(['config', 'color.ui', 'always'], wt);
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    // About 300 KB of new lines, past the preview's 250,000 characters.
    write('data/big.txt', Array.from({ length: 10_000 }, (_, i) => `row ${i} of the generated data`).join('\n') + '\n');
    write('src/small.ts', 'small\n');

    const preview = await mgr.diff('s1', wt, 'u1');
    expect(preview).toMatch(/^The full diff is too long to show here\. The files it changes:\n\n/);
    expect(preview).toMatch(/data\/big\.txt \| 10000 \+/);
    expect(preview).toMatch(/src\/small\.ts \| +1 \+/);
    expect(preview).not.toContain('row 1 of');
    expect(preview).not.toContain('\x1b[');
  });

  it('does not send a turn\'s diff over the size limit to the window', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    write('dist/bundle.js', 'x'.repeat(5 * 1024 * 1024) + '\n');
    write('src/small.ts', 'small\n');

    // Git is stopped at the limit, rather than read to the end.
    expect(await mgr.fileDiff('s1', wt, 'u1', 'turn', 'dist/bundle.js')).toEqual({ kind: 'tooLarge', bytes: MAX_TEXT_FILE_BYTES, atLeast: true });
    expect(await mgr.fileDiff('s1', wt, 'u1', 'turn', 'src/small.ts')).toMatchObject({ kind: 'text', patch: expect.stringContaining('+small') });
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
