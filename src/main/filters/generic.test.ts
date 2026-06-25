import { describe, it, expect } from 'vitest';
import { stripAnsi, deduplicateLines, truncateOutput } from './generic.js';

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[31mError\x1b[0m')).toBe('Error');
  });

  it('removes bold/underline codes', () => {
    expect(stripAnsi('\x1b[1m\x1b[4mBold Underline\x1b[0m')).toBe('Bold Underline');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('removes cursor movement codes', () => {
    expect(stripAnsi('\x1b[2K\x1b[1Gprogress: 50%')).toBe('progress: 50%');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('deduplicateLines', () => {
  it('collapses consecutive identical lines', () => {
    const input = 'ok\nok\nok\nok\ndone';
    expect(deduplicateLines(input)).toBe('ok\n... repeated 3 more times\ndone');
  });

  it('preserves non-consecutive duplicates', () => {
    const input = 'a\nb\na\nb';
    expect(deduplicateLines(input)).toBe('a\nb\na\nb');
  });

  it('handles single-line input', () => {
    expect(deduplicateLines('hello')).toBe('hello');
  });

  it('handles empty input', () => {
    expect(deduplicateLines('')).toBe('');
  });

  it('collapses multiple groups independently', () => {
    const input = 'a\na\na\nb\nb\nb\nc';
    expect(deduplicateLines(input)).toBe('a\n... repeated 2 more times\nb\n... repeated 2 more times\nc');
  });

  it('does not collapse two consecutive identical lines (needs 3+)', () => {
    const input = 'a\na\nb';
    expect(deduplicateLines(input)).toBe('a\na\nb');
  });
});

describe('truncateOutput', () => {
  it('returns short output unchanged', () => {
    expect(truncateOutput('short', 100)).toBe('short');
  });

  it('truncates long output with line count', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const input = lines.join('\n');
    const result = truncateOutput(input, 200);
    expect(result).toContain('line 1');
    expect(result).toContain('[... truncated');
    expect(result.length).toBeLessThanOrEqual(300); // some slack for the truncation message
  });

  it('handles empty input', () => {
    expect(truncateOutput('', 100)).toBe('');
  });

  it('includes tail lines when truncating', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const input = lines.join('\n');
    const result = truncateOutput(input, 200);
    expect(result).toContain('line 100'); // last line preserved
  });
});
