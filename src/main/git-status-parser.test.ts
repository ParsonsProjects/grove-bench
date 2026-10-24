import { describe, it, expect } from 'vitest';
import { parseGitStatusPorcelain, parseNumstat } from './git-status-parser.js';

describe('parseGitStatusPorcelain', () => {
  it('returns empty entries for empty input', () => {
    expect(parseGitStatusPorcelain('')).toEqual({ entries: [] });
  });

  it('parses untracked files', () => {
    const raw = '?? newfile.txt\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'newfile.txt', status: 'untracked', staged: false },
    ]);
  });

  it('gives a file in conflict one entry, never staged, with its code', () => {
    const raw = 'UU both.txt\0AA new.txt\0DU gone-here.txt\0UD gone-there.txt\0M  ok.ts\0';
    expect(parseGitStatusPorcelain(raw).entries).toEqual([
      { filePath: 'both.txt', status: 'conflicted', staged: false, conflict: 'UU' },
      { filePath: 'new.txt', status: 'conflicted', staged: false, conflict: 'AA' },
      { filePath: 'gone-here.txt', status: 'conflicted', staged: false, conflict: 'DU' },
      { filePath: 'gone-there.txt', status: 'conflicted', staged: false, conflict: 'UD' },
      { filePath: 'ok.ts', status: 'modified', staged: true },
    ]);
  });

  it('parses staged modified file', () => {
    const raw = 'M  src/app.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'src/app.ts', status: 'modified', staged: true },
    ]);
  });

  it('parses unstaged modified file', () => {
    const raw = ' M src/app.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'src/app.ts', status: 'modified', staged: false },
    ]);
  });

  it('parses file with both staged and unstaged changes (MM)', () => {
    const raw = 'MM src/app.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'src/app.ts', status: 'modified', staged: true },
      { filePath: 'src/app.ts', status: 'modified', staged: false },
    ]);
  });

  it('parses staged added file', () => {
    const raw = 'A  src/new.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'src/new.ts', status: 'added', staged: true },
    ]);
  });

  it('parses staged deleted file', () => {
    const raw = 'D  old.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'old.ts', status: 'deleted', staged: true },
    ]);
  });

  it('parses unstaged deleted file', () => {
    const raw = ' D old.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'old.ts', status: 'deleted', staged: false },
    ]);
  });

  it('parses staged rename with origPath', () => {
    // -z format: "R  new.ts\0old.ts"
    const raw = 'R  new.ts\0old.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'new.ts', status: 'renamed', staged: true, origPath: 'old.ts' },
    ]);
  });

  it('parses staged copy with origPath', () => {
    const raw = 'C  copy.ts\0original.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'copy.ts', status: 'copied', staged: true, origPath: 'original.ts' },
    ]);
  });

  it('parses multiple files', () => {
    const raw = 'M  staged.ts\0 M unstaged.ts\0?? new.txt\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ filePath: 'staged.ts', status: 'modified', staged: true });
    expect(result.entries[1]).toEqual({ filePath: 'unstaged.ts', status: 'modified', staged: false });
    expect(result.entries[2]).toEqual({ filePath: 'new.txt', status: 'untracked', staged: false });
  });

  it('handles paths with spaces', () => {
    const raw = ' M path with spaces/file name.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'path with spaces/file name.ts', status: 'modified', staged: false },
    ]);
  });

  it('handles added and modified (AM) — staged add with unstaged changes', () => {
    const raw = 'AM src/new.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toEqual([
      { filePath: 'src/new.ts', status: 'added', staged: true },
      { filePath: 'src/new.ts', status: 'modified', staged: false },
    ]);
  });

  it('parses a rename in the worktree column, from git add -N, with origPath', () => {
    // As git 2.43 writes it: the old path follows here too.
    const raw = ' R b.txt\0a.txt\0 M z.txt\0';
    expect(parseGitStatusPorcelain(raw).entries).toEqual([
      { filePath: 'b.txt', status: 'renamed', staged: false, origPath: 'a.txt' },
      { filePath: 'z.txt', status: 'modified', staged: false },
    ]);
  });

  it('gives origPath only to the column that renamed', () => {
    expect(parseGitStatusPorcelain('RM new.ts\0old.ts\0').entries).toEqual([
      { filePath: 'new.ts', status: 'renamed', staged: true, origPath: 'old.ts' },
      { filePath: 'new.ts', status: 'modified', staged: false },
    ]);
  });

  it('handles rename with trailing NUL (no extra empty entry)', () => {
    const raw = 'R  new.ts\0old.ts\0M  other.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ filePath: 'new.ts', status: 'renamed', staged: true, origPath: 'old.ts' });
    expect(result.entries[1]).toEqual({ filePath: 'other.ts', status: 'modified', staged: true });
  });
});

describe('parseNumstat', () => {
  it('returns empty for empty input', () => {
    expect(parseNumstat('')).toEqual([]);
  });

  it('parses additions and deletions per file', () => {
    const raw = '12\t3\tsrc/a.ts\x000\t5\tsrc/b.ts\x00';
    expect(parseNumstat(raw)).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3, binary: false },
      { path: 'src/b.ts', additions: 0, deletions: 5, binary: false },
    ]);
  });

  it('lists a rename under its new path', () => {
    // -z: the path is empty, then the old and new paths follow.
    const raw = '1\t0\t\x00src/a.ts\x00src/b.ts\x002\t2\tc.ts\x00';
    expect(parseNumstat(raw)).toEqual([
      { path: 'src/b.ts', additions: 1, deletions: 0, binary: false },
      { path: 'c.ts', additions: 2, deletions: 2, binary: false },
    ]);
  });

  it('marks binary changes (- / -) with zero counts', () => {
    const raw = '-\t-\tassets/logo.png\x00';
    expect(parseNumstat(raw)).toEqual([
      { path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
    ]);
  });

  it('preserves paths containing tabs and newlines', () => {
    const raw = '1\t1\tweird\tname.ts\x002\t0\tline\nbreak.ts\x00';
    expect(parseNumstat(raw)).toEqual([
      { path: 'weird\tname.ts', additions: 1, deletions: 1, binary: false },
      { path: 'line\nbreak.ts', additions: 2, deletions: 0, binary: false },
    ]);
  });

  it('skips malformed records', () => {
    const raw = 'garbage\x003\t4\tok.ts\x00';
    expect(parseNumstat(raw)).toEqual([
      { path: 'ok.ts', additions: 3, deletions: 4, binary: false },
    ]);
  });
});

import { parseNameStatus, parseHashObjectOutput, parseDiffRaw } from './git-status-parser.js';

describe('parseNameStatus', () => {
  it('parses modified, added, deleted, and renamed records', () => {
    const raw = ['M', 'src/a.ts', 'A', 'src/new.ts', 'D', 'gone.ts', 'R100', 'old.ts', 'renamed.ts', ''].join('\0');
    expect(parseNameStatus(raw)).toEqual([
      { filePath: 'src/a.ts', status: 'modified', staged: false },
      { filePath: 'src/new.ts', status: 'added', staged: false },
      { filePath: 'gone.ts', status: 'deleted', staged: false },
      { filePath: 'renamed.ts', status: 'renamed', staged: false, origPath: 'old.ts' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('parseHashObjectOutput', () => {
  it('maps hashes to paths in order', () => {
    expect(parseHashObjectOutput('aaa\nbbb\n', ['x', 'y'])).toEqual(new Map([['x', 'aaa'], ['y', 'bbb']]));
  });
});

describe('parseDiffRaw', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const Z = '0'.repeat(40);

  it('parses status and attaches the new-side blob id as content hash', () => {
    const raw = [`:100644 100644 ${A} ${B} M`, 'src/a.ts', `:000000 100644 ${Z} ${B} A`, 'new.ts', `:100644 000000 ${A} ${Z} D`, 'gone.ts', ''].join('\0');
    expect(parseDiffRaw(raw)).toEqual([
      { filePath: 'src/a.ts', status: 'modified', staged: false, contentHash: B },
      { filePath: 'new.ts', status: 'added', staged: false, contentHash: B },
      { filePath: 'gone.ts', status: 'deleted', staged: false, contentHash: 'deleted' },
    ]);
  });

  it('parses renames with their two paths', () => {
    const raw = [`:100644 100644 ${A} ${B} R100`, 'old.ts', 'renamed.ts', ''].join('\0');
    expect(parseDiffRaw(raw)).toEqual([
      { filePath: 'renamed.ts', status: 'renamed', staged: false, origPath: 'old.ts', contentHash: B },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseDiffRaw('')).toEqual([]);
  });
});
