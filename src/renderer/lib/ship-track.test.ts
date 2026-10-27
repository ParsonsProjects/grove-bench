import { describe, it, expect } from 'vitest';
import { shipTrack, type ShipTrackInput } from './ship-track.js';
import type { PrInfo } from '../../shared/types.js';

const pushed = { upstream: 'origin/feat', ahead: 0, behind: 0 };
const pr = (over: Partial<PrInfo> = {}): PrInfo => ({ number: 42, url: 'https://github.com/o/r/pull/42', state: 'OPEN', ...over });

function track(over: Partial<ShipTrackInput> = {}) {
  return shipTrack({ sync: pushed, pr: null, pushFailed: false, canCreatePr: false, ...over });
}
/** Each step as "Label: state (detail)". */
function steps(over: Partial<ShipTrackInput> = {}) {
  return track(over).steps.map((s) => `${s.label}: ${s.state}${s.detail ? ` (${s.detail})` : ''}`);
}

describe('shipTrack', () => {
  it('asks for a push when commits wait, and marks it', () => {
    const t = track({ sync: { ...pushed, ahead: 2 } });
    expect(t.steps[0]).toMatchObject({ state: 'next', detail: '2 commits to push' });
    expect(t.actionable).toBe(true);
    expect(t.summary).toBe('2 commits to push');
  });

  it('does not mark a branch that was never pushed: git reports nothing ahead', () => {
    const t = track({ sync: { upstream: null, ahead: 0, behind: 0 }, canCreatePr: true });
    expect(steps({ sync: { upstream: null, ahead: 0, behind: 0 }, canCreatePr: true }).slice(0, 2)).toEqual([
      'Push: todo (not pushed yet)',
      'PR: todo (none yet)',
    ]);
    expect(t.actionable).toBe(false);
    expect(t.summary).toBe('not pushed yet, no PR yet');
  });

  it('offers a PR once pushed', () => {
    const t = track({ canCreatePr: true });
    expect(t.steps[1]).toMatchObject({ state: 'next', detail: 'none yet' });
    expect(t.actionable).toBe(true);
  });

  it('marks a failed push, whatever else is true', () => {
    const t = track({ pushFailed: true, pr: pr() });
    expect(t.steps[0]).toMatchObject({ state: 'failed', detail: 'push failed' });
    expect(t.actionable).toBe(true);
  });

  it('says how far behind an up-to-date branch is', () => {
    expect(track({ sync: { ...pushed, behind: 3 } }).steps[0].detail).toBe('up to date, 3 behind');
  });

  it('follows an open PR through checks and review', () => {
    expect(steps({ pr: pr({ checks: { total: 3, passed: 1, failed: 0, pending: 2 }, reviewDecision: 'REVIEW_REQUIRED' }) })).toEqual([
      'Push: done (up to date)',
      'PR: done (#42 open)',
      'Checks: running (1 of 3 passed, 2 running)',
      'Review: todo (review required)',
      'Merge: todo',
    ]);
  });

  it('marks failed checks and requested changes on an open PR', () => {
    const failing = track({ pr: pr({ checks: { total: 2, passed: 1, failed: 1, pending: 0 } }) });
    expect(failing.steps[2].state).toBe('failed');
    expect(failing.actionable).toBe(true);
    expect(failing.summary).toBe('up to date, PR #42 open, checks: 1 of 2 failed');

    // Checks still running on top of a failure are counted too.
    expect(track({ pr: pr({ checks: { total: 4, passed: 1, failed: 1, pending: 2 } }) }).steps[2].detail).toBe('1 of 4 failed, 2 running');

    const changes = track({ pr: pr({ reviewDecision: 'CHANGES_REQUESTED' }) });
    expect(changes.steps[3].state).toBe('attention');
    expect(changes.actionable).toBe(true);
  });

  it('leaves nothing to do on a closed PR, and greys its open steps', () => {
    const t = track({ pr: pr({ state: 'CLOSED', checks: { total: 1, passed: 0, failed: 1, pending: 0 }, reviewDecision: 'CHANGES_REQUESTED' }) });
    expect(t.steps.map((s) => s.state)).toEqual(['done', 'closed', 'closed', 'closed', 'closed']);
    expect(t.steps[4].detail).toBe('closed without merging');
    expect(t.actionable).toBe(false);
  });

  it('ends purple once merged', () => {
    const t = track({ pr: pr({ state: 'MERGED', checks: { total: 2, passed: 2, failed: 0, pending: 0 }, reviewDecision: 'APPROVED' }) });
    expect(steps({ pr: pr({ state: 'MERGED', checks: { total: 2, passed: 2, failed: 0, pending: 0 }, reviewDecision: 'APPROVED' }) })).toEqual([
      'Push: done (up to date)',
      'PR: done (#42 merged)',
      'Checks: done (2 passed)',
      'Review: done (approved)',
      'Merge: merged (merged)',
    ]);
    expect(t.actionable).toBe(false);
  });

  it('calls a draft a draft, and a PR with no checks or reviewers done for those steps', () => {
    expect(steps({ pr: pr({ isDraft: true, reviewDecision: '' }) }).slice(1, 4)).toEqual([
      'PR: done (#42 draft)',
      'Checks: done (none reported)',
      'Review: done (none required)',
    ]);
  });

  it('has something to say before anything happened', () => {
    expect(track({ sync: { upstream: null, ahead: 0, behind: 0 } }).summary).toBe('not pushed yet');
    expect(track().summary).toBe('up to date');
  });
});
