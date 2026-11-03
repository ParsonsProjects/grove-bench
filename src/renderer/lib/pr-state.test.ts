import { describe, it, expect } from 'vitest';
import { prStateFlag, isPrMerged } from './pr-state.js';
import type { PrInfo } from '../../shared/types.js';

const base: PrInfo = { number: 7, url: 'https://example.test/pr/7' };

describe('prStateFlag', () => {
  it('maps gh states to a single flag', () => {
    expect(prStateFlag({ ...base, state: 'MERGED' }).kind).toBe('merged');
    expect(prStateFlag({ ...base, state: 'CLOSED' }).kind).toBe('closed');
    expect(prStateFlag({ ...base, state: 'OPEN' }).kind).toBe('open');
  });

  it('reports draft only while the PR is open', () => {
    expect(prStateFlag({ ...base, state: 'OPEN', isDraft: true }).kind).toBe('draft');
    expect(prStateFlag({ ...base, state: 'MERGED', isDraft: true }).kind).toBe('merged');
    expect(prStateFlag({ ...base, state: 'CLOSED', isDraft: true }).kind).toBe('closed');
  });

  it('treats a missing state as open', () => {
    expect(prStateFlag(base).kind).toBe('open');
  });
});

describe('isPrMerged', () => {
  it('is true only for a merged PR', () => {
    expect(isPrMerged({ ...base, state: 'MERGED' })).toBe(true);
    expect(isPrMerged({ ...base, state: 'OPEN' })).toBe(false);
    expect(isPrMerged(null)).toBe(false);
    expect(isPrMerged(undefined)).toBe(false);
  });
});
