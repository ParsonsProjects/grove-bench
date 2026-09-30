import { describe, it, expect } from 'vitest';
import { prStateFlag, isPrMerged, prHealth } from './pr-state.js';
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

describe('prHealth', () => {
  const checks = (failed: number, pending: number) => ({ total: failed + pending + 1, passed: 1, failed, pending });

  it('is neutral with no PR, or an open PR with no checks or review', () => {
    expect(prHealth(null).kind).toBe('none');
    expect(prHealth(undefined).kind).toBe('none');
    expect(prHealth({ ...base, state: 'OPEN' }).kind).toBe('open');
    expect(prHealth({ ...base, state: 'OPEN' }).textClass).toBe(prHealth(null).textClass);
  });

  it('lets merged and closed win over checks', () => {
    expect(prHealth({ ...base, state: 'MERGED', checks: checks(2, 0) }).kind).toBe('merged');
    expect(prHealth({ ...base, state: 'CLOSED', checks: checks(0, 0) }).kind).toBe('closed');
  });

  it('ranks failing CI over changes requested over pending checks', () => {
    expect(prHealth({ ...base, checks: checks(1, 1), reviewDecision: 'CHANGES_REQUESTED' }).kind).toBe('failing');
    expect(prHealth({ ...base, checks: checks(0, 1), reviewDecision: 'CHANGES_REQUESTED' }).kind).toBe('changes-requested');
    expect(prHealth({ ...base, checks: checks(0, 1), reviewDecision: 'APPROVED' }).kind).toBe('pending');
  });

  it('is passing when approved or when every check has finished green', () => {
    expect(prHealth({ ...base, reviewDecision: 'APPROVED' }).kind).toBe('passing');
    expect(prHealth({ ...base, checks: checks(0, 0) }).kind).toBe('passing');
  });

  it('gives each kind matching background and text colours', () => {
    const failing = prHealth({ ...base, checks: checks(1, 0) });
    expect(failing.bgClass).toBe('bg-red-500');
    expect(failing.textClass).toBe('text-red-500');
  });
});
