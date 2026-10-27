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

  it('keeps one snapshot index for the thread between snapshots, and deletes it with the thread', async () => {
    const index = path.join(tmp, 'repo', '.git', 'worktrees', 'wt', 'grove-snapshot-s1.index');
    const mgr = new CheckpointManager();
    write('src/new.ts', 'new\n');
    await mgr.capture('s1', wt, 'u1');
    write('src/new.ts', 'newer\n');
    fs.rmSync(path.join(wt, 'a.ts'));
    await mgr.capture('s1', wt, 'u2');

    expect(fs.existsSync(index)).toBe(true);
    expect(run(['ls-tree', '-r', '--name-only', 'refs/grove/checkpoints/s1/turn/2'], wt).split('\n')).toEqual(['.gitignore', 'src/new.ts']);
    expect(run(['show', 'refs/grove/checkpoints/s1/turn/2:src/new.ts'], wt)).toBe('newer');

    await mgr.cleanup('s1', wt);
    expect(fs.existsSync(index)).toBe(false);
  });

  it('leaves out files ignored since the last snapshot, by a .gitignore or info/exclude', async () => {
    const mgr = new CheckpointManager();
    write('out/build.js', 'built\n');
    write('notes/todo.md', 'todo\n');
    await mgr.capture('s1', wt, 'u1');
    expect(run(['ls-tree', '-r', '--name-only', 'refs/grove/checkpoints/s1/turn/1'], wt)).toContain('out/build.js');

    write('.gitignore', '*.log\nout/\n');
    await mgr.capture('s1', wt, 'u2');
    fs.appendFileSync(path.join(tmp, 'repo', '.git', 'info', 'exclude'), 'notes/\n');
    await mgr.capture('s1', wt, 'u3');

    const files = (turn: number) => run(['ls-tree', '-r', '--name-only', `refs/grove/checkpoints/s1/turn/${turn}`], wt).split('\n');
    expect(files(2)).toEqual(['.gitignore', 'a.ts', 'notes/todo.md']);
    expect(files(3)).toEqual(['.gitignore', 'a.ts']);
  });

  // Git checks the content of a file changed in the same second as its index
  // was written. A copy of the index timed later would hide that.
  it('snapshots a file edited in the second it was committed, at the same size', async () => {
    // At the start of a second, so the commit and the edit share it (if a
    // slow machine misses it, the test passes without testing anything)...
    await new Promise((r) => setTimeout(r, 1050 - (Date.now() % 1000)));
    write('a.ts', 'uno\n');
    run(['commit', '-qam', 'uno'], wt);
    write('a.ts', 'dos\n');
    // ...and the snapshot in a later one.
    await new Promise((r) => setTimeout(r, 1100));

    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    expect(run(['show', 'refs/grove/checkpoints/s1/turn/1:a.ts'], wt)).toBe('dos');
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

  // The checkpoint is taken before its turn, so the files as they are at a
  // rewind (the last turn's edits, the user's own) would otherwise be lost.
  it('keeps the files a rewind replaces, brings them back, and swaps back', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    write('a.ts', 'two\n');
    await mgr.capture('s1', wt, 'u2');
    write('a.ts', 'three, from the last turn\n');
    write('src/added.ts', 'added by the last turn\n');
    write('notes.md', 'the user\'s own, never in a checkpoint\n');
    write('debug.log', 'ignored\n');

    const copy = await mgr.restore('s1', wt, 'u1');
    expect(read('a.ts')).toBe('one\n');
    expect(exists('src/added.ts')).toBe(false);
    expect(exists('notes.md')).toBe(false);

    const rewound = await mgr.restoreKept('s1', wt, copy);
    expect(read('a.ts')).toBe('three, from the last turn\n');
    expect(read('src/added.ts')).toBe('added by the last turn\n');
    expect(read('notes.md')).toBe('the user\'s own, never in a checkpoint\n');
    expect(read('debug.log')).toBe('ignored\n');
    expect(run(['diff', '--cached', '--name-only'], wt)).toBe('');

    // Bringing them back kept the rewound files in turn.
    await mgr.restoreKept('s1', wt, rewound);
    expect(read('a.ts')).toBe('one\n');
    expect(exists('notes.md')).toBe(false);
  });

  // Each line in the thread names its own copy, so an older one still works.
  it('brings back an older copy after a later rewind', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    write('a.ts', 'first try\n');
    const firstTry = await mgr.restore('s1', wt, 'u1');
    write('a.ts', 'second try\n');
    await mgr.restore('s1', wt, 'u1');

    await mgr.restoreKept('s1', wt, firstTry);
    expect(read('a.ts')).toBe('first try\n');
  });

  it('keeps the copies out of the checkpoint list, and deletes them with the thread', async () => {
    const mgr = new CheckpointManager();
    await mgr.capture('s1', wt, 'u1');
    write('a.ts', 'two\n');
    await mgr.restore('s1', wt, 'u1');
    expect(run(['for-each-ref', '--format=%(refname)', 'refs/grove/'], wt).split('\n'))
      .toEqual(['refs/grove/checkpoints/s1/kept', 'refs/grove/checkpoints/s1/turn/1']);

    expect((await mgr.list('s1', wt)).map((c) => c.uuid)).toEqual(['u1']);
    // A new manager, as after a restart, resumes the turns only.
    const resumed = new CheckpointManager();
    await resumed.resume('s1', wt);
    expect(await resumed.capture('s1', wt, 'u2')).toBe(true);
    expect(run(['for-each-ref', '--format=%(refname)', 'refs/grove/checkpoints/s1/turn/'], wt).split('\n'))
      .toEqual(['refs/grove/checkpoints/s1/turn/1', 'refs/grove/checkpoints/s1/turn/2']);

    await resumed.cleanup('s1', wt);
    expect(run(['for-each-ref', 'refs/grove/'], wt)).toBe('');
  });

  it('brings back only copies it kept for this thread', async () => {
    const mgr = new CheckpointManager();
    const head = run(['rev-parse', 'HEAD'], wt);
    await expect(mgr.restoreKept('s1', wt, head)).rejects.toThrow('There are no kept files to bring back.');

    await mgr.capture('s1', wt, 'u1');
    write('a.ts', 'two\n');
    await mgr.restore('s1', wt, 'u1');
    await expect(mgr.restoreKept('s1', wt, head)).rejects.toThrow('That copy of the files is no longer kept.');
    await expect(mgr.restoreKept('s1', wt, 'f'.repeat(40))).rejects.toThrow('That copy of the files is no longer kept.');
    await expect(mgr.restoreKept('s1', wt, '--all')).rejects.toThrow('That copy of the files is no longer kept.');
    expect(read('a.ts')).toBe('one\n');
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
