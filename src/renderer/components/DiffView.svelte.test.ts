import { describe, it, expect } from 'vitest';
import { parseDiffLines } from './DiffView.svelte';

describe('parseDiffLines', () => {
  it('keeps changed lines that start with --- or +++', () => {
    const patch = [
      'diff --git a/q.sql b/q.sql',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1,3 +1,3 @@',
      ' select 1;',
      '--- old comment',
      '+++i;',
      ' select 2;',
      '',
    ].join('\n');

    const lines = parseDiffLines(patch);

    expect(lines.map((l) => [l.type, l.text])).toEqual([
      ['hunk', '@@ -1,3 +1,3 @@'],
      ['context', 'select 1;'],
      ['del', '-- old comment'],
      ['add', '++i;'],
      ['context', 'select 2;'],
    ]);
    const last = lines.at(-1)!;
    expect([last.oldLineNum, last.newLineNum]).toEqual([3, 3]);
  });

  it('still skips the headers of a second file after the first hunk ends', () => {
    const patch = [
      '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-a', '+b',
      '--- a/b.ts', '+++ b/b.ts', '@@ -5 +5 @@', '-c', '+d', '',
    ].join('\n');

    expect(parseDiffLines(patch).map((l) => l.type)).toEqual(['hunk', 'del', 'add', 'hunk', 'del', 'add']);
  });
});
