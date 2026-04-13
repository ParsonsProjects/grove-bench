import { describe, it, expect } from 'vitest';
import { filterLsOutput, filterFindOutput } from './filesystem.js';

describe('filterLsOutput', () => {
  it('compacts ls -la output to essential columns', () => {
    const input = [
      'total 48',
      'drwxr-xr-x  5 user group  4096 Apr 13 10:00 .',
      'drwxr-xr-x  3 user group  4096 Apr 13 09:00 ..',
      '-rw-r--r--  1 user group  1234 Apr 13 10:00 package.json',
      'drwxr-xr-x  4 user group  4096 Apr 13 10:00 src',
      '-rw-r--r--  1 user group   567 Apr 13 10:00 tsconfig.json',
    ].join('\n');
    const result = filterLsOutput(input);
    expect(result).toContain('package.json');
    expect(result).toContain('src');
    expect(result).toContain('tsconfig.json');
    // Should strip . and .. entries
    expect(result).not.toMatch(/\s\.$/m);
    expect(result).not.toMatch(/\s\.\.$/m);
  });

  it('handles empty directory listing', () => {
    const input = 'total 0';
    const result = filterLsOutput(input);
    expect(result).toBe('(empty)');
  });

  it('passes through simple ls output', () => {
    const input = 'file1.ts\nfile2.ts\ndir1';
    expect(filterLsOutput(input)).toBe('file1.ts\nfile2.ts\ndir1');
  });
});

describe('filterFindOutput', () => {
  it('truncates at limit and shows count', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `./src/file${i}.ts`);
    const input = lines.join('\n');
    const result = filterFindOutput(input);
    expect(result).toContain('[... 200 total results, showing first 100]');
    const resultLines = result.split('\n');
    // 100 file lines + 1 truncation notice
    expect(resultLines.length).toBeLessThanOrEqual(102);
  });

  it('returns all results when under limit', () => {
    const input = './src/a.ts\n./src/b.ts\n./src/c.ts';
    const result = filterFindOutput(input);
    expect(result).toBe('./src/a.ts\n./src/b.ts\n./src/c.ts');
  });

  it('handles empty output', () => {
    expect(filterFindOutput('')).toBe('');
  });
});
