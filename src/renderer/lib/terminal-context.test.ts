import { describe, it, expect } from 'vitest';
import { collectTailLines, formatTerminalContext, truncateHead } from './terminal-context.js';

function bufferOf(lines: string[]) {
  return {
    length: lines.length,
    getLine: (y: number) => (y < lines.length ? { translateToString: () => lines[y] } : undefined),
  };
}

describe('collectTailLines', () => {
  it('returns the last N lines oldest-first, dropping trailing blank rows', () => {
    const buf = bufferOf(['a', 'b', '', 'c', '', '', '']);
    expect(collectTailLines(buf, 10)).toEqual(['a', 'b', '', 'c']);
    expect(collectTailLines(buf, 2)).toEqual(['', 'c']);
  });

  it('handles an empty buffer', () => {
    expect(collectTailLines(bufferOf([]))).toEqual([]);
    expect(collectTailLines(bufferOf(['', '']))).toEqual([]);
  });
});

describe('truncateHead', () => {
  it('keeps the tail and cuts at a line boundary', () => {
    const r = truncateHead('line1\nline2\nline3', 9);
    expect(r).toEqual({ text: 'line3', truncated: true });
    expect(truncateHead('short', 10)).toEqual({ text: 'short', truncated: false });
  });
});

describe('formatTerminalContext', () => {
  it('fences the tail with a line count', () => {
    const out = formatTerminalContext('npm test\r\n3 passed\r\n\r\n', { selected: false });
    expect(out).toBe('Terminal output (last 2 lines):\n```text\nnpm test\n3 passed\n```');
  });

  it('labels selections and singular lines', () => {
    expect(formatTerminalContext('one', { selected: true })).toBe('Terminal selection:\n```text\none\n```');
    expect(formatTerminalContext('one', { selected: false })).toContain('(last 1 line)');
  });

  it('returns empty for blank input', () => {
    expect(formatTerminalContext('  \n\n', { selected: false })).toBe('');
  });

  it('notes truncation', () => {
    const out = formatTerminalContext('a\nb\nc', { selected: false, maxChars: 3 });
    expect(out.startsWith('Terminal output (last 1 line), earlier output truncated:')).toBe(true);
    expect(out).toContain('\nc\n');
  });

  it('uses a fence longer than any backtick run in the text', () => {
    const out = formatTerminalContext('x ```` y', { selected: true });
    expect(out).toContain('`````text\n');
    expect(out.endsWith('\n`````')).toBe(true);
  });
});
