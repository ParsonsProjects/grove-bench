import { describe, it, expect } from 'vitest';
import { tailCiLog, CI_LOG_TAIL_LINES, CI_LOG_TAIL_CHARS } from './ci-log.js';

const ts = (n: number) => `2026-11-01T12:00:${String(n % 60).padStart(2, '0')}.1234567Z `;

describe('tailCiLog()', () => {
  it('strips the BOM, timestamps, colours and group markers', () => {
    const raw = `\uFEFF${ts(1)}##[group]Run npm test\n${ts(2)}\x1b[31mFAIL\x1b[0m src/a.test.ts\n${ts(3)}##[endgroup]\n${ts(4)}##[error]Process completed with exit code 1.\n`;
    expect(tailCiLog(raw)).toEqual({
      text: 'Run npm test\nFAIL src/a.test.ts\n##[error]Process completed with exit code 1.',
      omittedBefore: 0,
      omittedAfter: 0,
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
    expect(tail.omittedAfter).toBe(3);
    expect(tail.errorLine).toBe(4);
  });

  it('keeps the last lines when the log is long', () => {
    const lines = Array.from({ length: CI_LOG_TAIL_LINES + 50 }, (_, i) => `line ${i}`);
    const tail = tailCiLog(lines.join('\n'));
    expect(tail.text.split('\n')).toHaveLength(CI_LOG_TAIL_LINES);
    expect(tail.text.startsWith('line 50\n')).toBe(true);
    expect(tail.omittedBefore).toBe(50);
    expect(tail).not.toHaveProperty('errorLine');
  });

  it('keeps within the character cap, by whole lines, or the end of one huge line', () => {
    const long = 'x'.repeat(CI_LOG_TAIL_CHARS / 2);
    expect(tailCiLog([long, long, 'end'].join('\n')).text).toBe(`${long}\nend`);
    const huge = `${'a'.repeat(10)}${'b'.repeat(CI_LOG_TAIL_CHARS)}`;
    expect(tailCiLog(huge).text).toBe('b'.repeat(CI_LOG_TAIL_CHARS));
  });

  it('ignores blank lines at the end', () => {
    expect(tailCiLog('one\ntwo\n\n\n')).toMatchObject({ text: 'one\ntwo', omittedAfter: 0 });
  });
});
