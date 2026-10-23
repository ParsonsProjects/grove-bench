import { describe, it, expect } from 'vitest';
import { effectiveCompactTimeoutSeconds } from './compact-timeout.js';

describe('effectiveCompactTimeoutSeconds', () => {
  it('keeps a value in range', () => {
    expect(effectiveCompactTimeoutSeconds(45)).toBe(45);
    expect(effectiveCompactTimeoutSeconds(300)).toBe(300);
  });

  it('uses the default for an unset, zero or invalid value', () => {
    for (const v of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveCompactTimeoutSeconds(v)).toBe(300);
    }
  });

  it('raises a short timeout to the floor and caps a long one at an hour', () => {
    expect(effectiveCompactTimeoutSeconds(5)).toBe(30);
    expect(effectiveCompactTimeoutSeconds(3_000_000)).toBe(3600);
  });

  it('rounds to a whole second', () => {
    expect(effectiveCompactTimeoutSeconds(45.5)).toBe(46);
  });
});
