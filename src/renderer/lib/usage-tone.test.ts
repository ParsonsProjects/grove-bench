import { describe, it, expect } from 'vitest';
import { usageTone, usageTextClass, usageBarClass } from './usage-tone.js';

describe('usageTone', () => {
  // The steps in docs/help/status-bar.md: 0-40 green, 40-70 yellow,
  // 70-85 orange, 85-100 red.
  it.each([
    [0, 'ok'],
    [40, 'ok'],
    [41, 'filling'],
    [70, 'filling'],
    [71, 'low'],
    [85, 'low'],
    [86, 'full'],
    [100, 'full'],
  ] as const)('%d%% is %s', (pct, tone) => {
    expect(usageTone(pct)).toBe(tone);
  });

  it('gives text and bar classes from the same step', () => {
    expect(usageTextClass(90)).toBe('text-red-400');
    expect(usageBarClass(90)).toBe('bg-red-400');
    expect(usageTextClass(10)).toBe('text-green-400');
    expect(usageBarClass(10)).toBe('bg-green-500');
  });
});
