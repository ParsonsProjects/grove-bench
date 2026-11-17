import { describe, it, expect } from 'vitest';
import { formatStepDuration, stepTiming } from './compaction-steps.js';
import type { MemoryCompactionStep } from '../../shared/types.js';

const step = (extra: Partial<MemoryCompactionStep>): MemoryCompactionStep => ({
  index: 1, label: 'Merge 1: repo/a.md', state: 'done', model: null,
  systemPrompt: '', userMessage: '', startedAt: 10_000, inputBytes: 20 * 1024, ...extra,
});

describe('formatStepDuration', () => {
  it('shows tenths of a second under a minute, then minutes and seconds', () => {
    expect(formatStepDuration(0)).toBe('0.0s');
    expect(formatStepDuration(4210)).toBe('4.2s');
    expect(formatStepDuration(59_940)).toBe('59.9s');
    expect(formatStepDuration(65_000)).toBe('1:05');
    expect(formatStepDuration(600_000)).toBe('10:00');
  });

  it('never shows a negative time', () => {
    expect(formatStepDuration(-50)).toBe('0.0s');
  });
});

describe('stepTiming', () => {
  it('counts a running step from when it started', () => {
    expect(stepTiming(step({ state: 'running' }), 13_500)).toBe('3.5s so far · 20 KB in');
  });

  it('splits an ended step into the agent starting and the model replying', () => {
    expect(stepTiming(step({ startupMs: 2000, durationMs: 47_000, outputBytes: 6 * 1024 }), 0))
      .toBe('agent up 2.0s · reply 45.0s · 20 KB in · 6 KB out');
  });

  it('gives the whole time when the agent never said it was up', () => {
    expect(stepTiming(step({ state: 'failed', durationMs: 1500 }), 0)).toBe('1.5s · 20 KB in');
  });
});
