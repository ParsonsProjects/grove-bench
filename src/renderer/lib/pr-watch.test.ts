import { describe, it, expect } from 'vitest';
import { detectPrEvents, newPrWatchState, isTrustedAssociation } from './pr-watch.js';
import type { PrInfo } from '../../shared/types.js';

function pr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 1,
    url: 'u',
    state: 'OPEN',
    headSha: 'sha1',
    checks: { total: 3, passed: 3, failed: 0, pending: 0 },
    failingChecks: [],
    commentSignature: [],
    ...overrides,
  };
}

describe('detectPrEvents()', () => {
  it('seeds silently on the first poll — no alerts for pre-existing state', () => {
    const state = newPrWatchState();
    const events = detectPrEvents(state, pr({
      checks: { total: 3, passed: 1, failed: 2, pending: 0 },
      failingChecks: ['test', 'lint'],
      commentSignature: ['c:1', 'r:2'],
    }));
    expect(events).toEqual([]);
    expect(state.seeded).toBe(true);
  });

  it('reports a failure appearing after the baseline', () => {
    const state = newPrWatchState();
    detectPrEvents(state, pr()); // seed: green
    const events = detectPrEvents(state, pr({
      checks: { total: 3, passed: 2, failed: 1, pending: 0 },
      failingChecks: ['test'],
    }));
    expect(events).toEqual([{ kind: 'ci_failed', checks: ['test'] }]);
  });

  it('does not re-alert the same failing commit on subsequent polls', () => {
    const state = newPrWatchState();
    detectPrEvents(state, pr());
    const failing = pr({ checks: { total: 3, passed: 2, failed: 1, pending: 0 }, failingChecks: ['test'] });
    detectPrEvents(state, failing);
    expect(detectPrEvents(state, failing)).toEqual([]);
  });

  it('alerts again when a new commit fails', () => {
    const state = newPrWatchState();
    detectPrEvents(state, pr());
    detectPrEvents(state, pr({ headSha: 'sha1', checks: { total: 3, passed: 2, failed: 1, pending: 0 }, failingChecks: ['test'] }));
    const events = detectPrEvents(state, pr({ headSha: 'sha2', checks: { total: 3, passed: 2, failed: 1, pending: 0 }, failingChecks: ['lint'] }));
    expect(events).toEqual([{ kind: 'ci_failed', checks: ['lint'] }]);
  });

  it('re-arms after checks recover on the same commit', () => {
    const state = newPrWatchState();
    detectPrEvents(state, pr());
    const failing = pr({ checks: { total: 3, passed: 2, failed: 1, pending: 0 }, failingChecks: ['test'] });
    detectPrEvents(state, failing);       // alert
    detectPrEvents(state, pr());          // green again on sha1 → re-arm
    expect(detectPrEvents(state, failing)).toEqual([{ kind: 'ci_failed', checks: ['test'] }]);
  });

  it('reports new comments once', () => {
    const state = newPrWatchState();
    detectPrEvents(state, pr({ commentSignature: ['c:1'] })); // seed
    const events = detectPrEvents(state, pr({ commentSignature: ['c:1', 'c:2', 'r:3'] }));
    expect(events).toEqual([{ kind: 'new_comments', count: 2 }]);
    expect(detectPrEvents(state, pr({ commentSignature: ['c:1', 'c:2', 'r:3'] }))).toEqual([]);
  });

  it('is silent for null, merged, or closed PRs', () => {
    const state = newPrWatchState();
    expect(detectPrEvents(state, null)).toEqual([]);
    expect(detectPrEvents(state, pr({ state: 'MERGED' }))).toEqual([]);
    expect(state.seeded).toBe(false);
  });
});

describe('isTrustedAssociation()', () => {
  it('trusts owner, member, and collaborator', () => {
    expect(isTrustedAssociation('OWNER')).toBe(true);
    expect(isTrustedAssociation('member')).toBe(true);
    expect(isTrustedAssociation('COLLABORATOR')).toBe(true);
  });

  it('does not trust contributors or outsiders', () => {
    expect(isTrustedAssociation('CONTRIBUTOR')).toBe(false);
    expect(isTrustedAssociation('NONE')).toBe(false);
    expect(isTrustedAssociation('')).toBe(false);
  });
});
