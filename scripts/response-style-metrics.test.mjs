import { describe, it, expect } from 'vitest';
import { splitTurnText, wordCount, measureRun, median, summarize, percentChange, renderReport } from './response-style-metrics.mjs';

const text = (t) => ({ type: 'text', text: t });
const tool = (name = 'Read') => ({ type: 'tool_use', name });

describe('splitTurnText', () => {
  it('counts text before a later tool call as notes and the rest as the answer', () => {
    const { notes, answer } = splitTurnText([text('Let me look'), tool(), text('Now the tests'), tool(), text('Fixed it.'), text('Tests pass.')]);
    expect(notes).toEqual(['Let me look', 'Now the tests']);
    expect(answer).toEqual(['Fixed it.', 'Tests pass.']);
  });

  it('treats a turn without tool calls as all answer, and skips blank blocks', () => {
    expect(splitTurnText([text('Just an answer'), text('  ')])).toEqual({ notes: [], answer: ['Just an answer'] });
  });
});

describe('wordCount', () => {
  it('counts words across whitespace, and none in blank text', () => {
    expect(wordCount('  two\nwords ')).toBe(2);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('measureRun', () => {
  it('takes tokens and cost from the result and words from the text', () => {
    const m = measureRun([text('Let me check the config'), tool(), text('Done: fixed the guard.')], {
      usage: { output_tokens: 1200 }, total_cost_usd: 0.12, num_turns: 2, duration_ms: 9000,
    });
    expect(m).toMatchObject({ outputTokens: 1200, costUsd: 0.12, turns: 2, toolCalls: 1, noteCount: 1, noteWords: 5, answerWords: 4, answer: 'Done: fixed the guard.' });
  });

  it('leaves the result fields empty when the run never finished', () => {
    expect(measureRun([], null)).toMatchObject({ outputTokens: null, costUsd: null, noteWords: 0, answerWords: 0 });
  });
});

describe('median and percentChange', () => {
  it('takes the middle value, or the mean of the middle two, ignoring gaps', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, null, 2, 3])).toBe(2.5);
    expect(median([null])).toBeNull();
  });

  it('gives no change from zero or a missing value', () => {
    expect(percentChange(200, 150)).toBe(-25);
    expect(percentChange(0, 10)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
  });
});

function run(task, style, rep, metrics, extra = {}) {
  return {
    task, style, rep, resultSubtype: 'success', error: null, checkPassed: null,
    metrics: { outputTokens: 0, noteWords: 0, answerWords: 0, toolCalls: 0, turns: 1, costUsd: 0, answer: '', ...metrics },
    ...extra,
  };
}

describe('summarize', () => {
  it('groups by task and style with the median, range, checks and unfinished runs', () => {
    const [off, brief] = summarize([
      run('a', 'off', 1, { outputTokens: 100 }, { checkPassed: true }),
      run('a', 'off', 2, { outputTokens: 300 }, { checkPassed: false }),
      run('a', 'brief', 1, { outputTokens: 80 }, { resultSubtype: 'error_max_turns' }),
    ]);
    expect(off).toMatchObject({ task: 'a', style: 'off', count: 2, checks: { passed: 1, of: 2 }, failed: 0 });
    expect(off.stats.outputTokens).toEqual({ median: 200, range: [100, 300] });
    expect(brief).toMatchObject({ style: 'brief', count: 1, checks: null, failed: 1 });
  });
});

describe('renderReport', () => {
  const meta = { date: '2026-10-13 09:00', commit: 'abc1234', model: null, runs: 1, styles: ['off', 'brief'], userSettings: false };

  it('tables each task, gives the change from the baseline, and lists every answer', () => {
    const report = renderReport([
      run('explain', 'off', 1, { outputTokens: 1000, noteWords: 40, answerWords: 200, answer: 'Long answer' }),
      run('explain', 'brief', 1, { outputTokens: 800, noteWords: 0, answerWords: 150, answer: 'Short answer' }),
    ], meta);
    expect(report).toContain('## explain');
    expect(report).toContain('| Normal | 1 | 1,000 | 40 | 200 |');
    expect(report).toContain('| Brief | -20% | -100% | -25% |');
    expect(report).toContain('<details><summary>Brief, run 1 (150 words)</summary>');
    expect(report).toContain('Short answer');
  });

  it('shows the range when runs differ, and says which runs did not finish', () => {
    const report = renderReport([
      run('fix', 'off', 1, { outputTokens: 100 }),
      run('fix', 'off', 2, { outputTokens: 300 }, { error: 'boom', resultSubtype: null }),
    ], { ...meta, runs: 2, styles: ['off'] });
    expect(report).toContain('| Normal | 2 (1 did not finish) | 200 (100 to 300) |');
    expect(report).toContain('Normal, run 2 (error: boom)');
    expect(report).not.toContain('## Change from');
  });
});
