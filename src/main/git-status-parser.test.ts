import { describe, it, expect } from 'vitest';
import { parseGitStatusPorcelain } from './git-status-parser.js';

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

  it('handles rename with trailing NUL (no extra empty entry)', () => {
    const raw = 'R  new.ts\0old.ts\0M  other.ts\0';
    const result = parseGitStatusPorcelain(raw);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ filePath: 'new.ts', status: 'renamed', staged: true, origPath: 'old.ts' });
    expect(result.entries[1]).toEqual({ filePath: 'other.ts', status: 'modified', staged: true });
  });
});
