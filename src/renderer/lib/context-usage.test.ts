import { describe, it, expect } from 'vitest';
import { contextUsage, formatTokens } from './context-usage.js';

describe('contextUsage', () => {
  it('counts cached tokens as used', () => {
    expect(contextUsage({ inputTokens: 2_000, cacheReadTokens: 170_000, cacheCreationTokens: 8_000 }, 200_000))
      .toEqual({ usedTokens: 180_000, freeTokens: 20_000, usedPercent: 90 });
  });

  it('stops at full', () => {
    expect(contextUsage({ inputTokens: 250_000, cacheReadTokens: 0, cacheCreationTokens: 0 }, 200_000))
      .toEqual({ usedTokens: 250_000, freeTokens: 0, usedPercent: 100 });
  });
});

describe('formatTokens', () => {
  it.each([
    [999, '999'],
    [1_234, '1.2k'],
    [1_500_000, '1.5M'],
  ])('%d -> %s', (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });
});
