import { describe, it, expect } from 'vitest';
import { tailCiLog, CI_LOG_TAIL_LINES, CI_LOG_TAIL_CHARS, CI_LOG_LINE_CHARS } from './ci-log.js';

const ts = (n: number) => `2026-11-01T12:00:${String(n % 60).padStart(2, '0')}.1234567Z `;

describe('tailCiLog()', () => {
  it('strips the BOM, timestamps, colours and group markers', () => {
    const raw = `\uFEFF${ts(1)}##[group]Run npm test\n${ts(2)}\x1b[31mFAIL\x1b[0m src/a.test.ts\n${ts(3)}##[endgroup]\n${ts(4)}##[error]Process completed with exit code 1.\n`;
    expect(tailCiLog(raw)).toEqual({
      text: 'Run npm test\nFAIL src/a.test.ts\n##[error]Process completed with exit code 1.',
      errorLine: 3,
    });
  });

  it('shows what a line redrawn with \\r ends as, and drops control and bidi characters', () => {
    expect(tailCiLog('10%\r50%\r100% done\r\nok\x07\u202e!').text).toBe('100% done\nok!');
  });

  it('ends a few lines after the last error, leaving out the cleanup steps', () => {
    const lines = ['build', '##[error]first', 'more', '##[error]last', 'a', 'b', 'c', 'd', 'e', 'Post job cleanup.', 'x', 'y'];
    const tail = tailCiLog(lines.join('\n'));
    expect(tail.text.split('\n')).toEqual(['build', '##[error]first', 'more', '##[error]last', 'a', 'b', 'c', 'd', 'e']);
    expect(tail.errorLine).toBe(4);
  });

  it('keeps the last lines when the log is long', () => {
    const lines = Array.from({ length: CI_LOG_TAIL_LINES + 50 }, (_, i) => `line ${i}`);
    const tail = tailCiLog(lines.join('\n'));
    expect(tail.text.split('\n')).toHaveLength(CI_LOG_TAIL_LINES);
    expect(tail.text.startsWith('line 50\n')).toBe(true);
    expect(tail).not.toHaveProperty('errorLine');
  });

  it('cuts a very long line short', () => {
    const tail = tailCiLog(`ok\n${'x'.repeat(CI_LOG_LINE_CHARS + 10)}`);
    expect(tail.text).toBe(`ok\n${'x'.repeat(CI_LOG_LINE_CHARS)}… (line cut short)`);
  });

  it('keeps within the character cap by whole lines, dropping lines after the error before lines before it', () => {
    const big = 'b'.repeat(CI_LOG_LINE_CHARS);
    // 20 lines before the error and 5 after, 4 KB each: 100 KB in all.
    const before = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}${big.slice(2)}`);
    const after = Array.from({ length: 5 }, () => big);
    const tail = tailCiLog([...before, '##[error]boom', ...after].join('\n'));
    expect(tail.text.length).toBeLessThanOrEqual(CI_LOG_TAIL_CHARS);
    const shown = tail.text.split('\n');
    // Every line after the error went before any line before it.
    expect(shown[shown.length - 1]).toBe('##[error]boom');
    expect(shown[tail.errorLine! - 1]).toBe('##[error]boom');
    expect(shown[0].startsWith('05')).toBe(true);
  });

  it('never drops the error line, however long the lines around it', () => {
    const huge = 'h'.repeat(CI_LOG_LINE_CHARS);
    const raw = ['pre', '##[error]boom', ...Array.from({ length: 40 }, () => huge)].join('\n');
    const tail = tailCiLog(['pre', ...Array.from({ length: 40 }, () => huge), '##[error]boom', huge, huge].join('\n'));
    expect(tail.errorLine).toBeDefined();
    expect(tail.text.split('\n')[tail.errorLine! - 1]).toBe('##[error]boom');
    expect(tailCiLog(raw).text.split('\n').slice(0, 2)).toEqual(['pre', '##[error]boom']);
  });

  it('ignores blank lines at the end', () => {
    expect(tailCiLog('one\ntwo\n\n\n')).toEqual({ text: 'one\ntwo' });
  });
});
