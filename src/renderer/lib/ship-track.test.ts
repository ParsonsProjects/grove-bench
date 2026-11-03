import { describe, it, expect } from 'vitest';
import { shipTrack, prShipTrack, type ShipTrackInput } from './ship-track.js';
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

  it('sums the steps up as one icon: shape for how far, colour for what matters most', () => {
    const stage = (over: Partial<ShipTrackInput> = {}) => track(over).stage;
    const passed = { total: 2, passed: 2, failed: 0, pending: 0 };
    expect(stage({ sync: { upstream: null, ahead: 0, behind: 0 } })).toEqual({ icon: 'branch', state: 'todo' });
    expect(stage({ pushFailed: true })).toEqual({ icon: 'branch', state: 'failed' });
    // A draft can't be merged yet: never green, however far its steps got.
    expect(stage({ pr: pr({ isDraft: true, checks: passed, reviewDecision: '' }) })).toEqual({ icon: 'draft', state: 'todo' });
    expect(stage({ pr: pr({ checks: passed, reviewDecision: 'APPROVED' }) })).toEqual({ icon: 'pr', state: 'done' });
    expect(stage({ pr: pr({ checks: passed, reviewDecision: 'REVIEW_REQUIRED' }) })).toEqual({ icon: 'pr', state: 'todo' });
    expect(stage({ pr: pr({ checks: { total: 2, passed: 1, failed: 0, pending: 1 } }) })).toEqual({ icon: 'pr', state: 'running' });
    // A failure outranks changes requested, which outranks checks running.
    expect(stage({ pr: pr({ checks: { total: 3, passed: 0, failed: 1, pending: 2 }, reviewDecision: 'CHANGES_REQUESTED' }) }).state).toBe('failed');
    expect(stage({ pr: pr({ checks: { total: 2, passed: 1, failed: 0, pending: 1 }, reviewDecision: 'CHANGES_REQUESTED' }) }).state).toBe('attention');
    // A merged PR's failed checks are greyed as closed; it is still merged.
    expect(stage({ pr: pr({ state: 'MERGED', checks: { total: 1, passed: 0, failed: 1, pending: 0 } }) })).toEqual({ icon: 'merged', state: 'merged' });
    expect(stage({ pushFailed: true, pr: pr({ state: 'MERGED' }) })).toEqual({ icon: 'merged', state: 'failed' });
    expect(stage({ pr: pr({ state: 'CLOSED' }) })).toEqual({ icon: 'closed', state: 'closed' });
  });

  it("reads another PR on its own, not by the thread's branch", () => {
    // Its branch's push state isn't fetched: done, and nothing said about it.
    expect(prShipTrack(pr()).summary).toBe('PR #42 open');
    expect(prShipTrack(pr()).stage).toEqual({ icon: 'pr', state: 'done' });
    expect(prShipTrack(pr({ reviewDecision: 'CHANGES_REQUESTED' })).stage.state).toBe('attention');
    expect(prShipTrack(pr({ state: 'CLOSED', checks: { total: 1, passed: 0, failed: 1, pending: 0 } })).stage).toEqual({ icon: 'closed', state: 'closed' });
  });

  it('has something to say before anything happened', () => {
    expect(track({ sync: { upstream: null, ahead: 0, behind: 0 } }).summary).toBe('not pushed yet');
    expect(track().summary).toBe('up to date');
  });
});

describe('shipTrack next', () => {
  const failing = { total: 3, passed: 2, failed: 1, pending: 0 };
  const running = { total: 3, passed: 2, failed: 0, pending: 1 };
  const green = { total: 3, passed: 3, failed: 0, pending: 0 };
  /** The Next notice as "tone: headline [action]", and whether the lozenge is marked. */
  function next(over: Partial<ShipTrackInput> = {}) {
    const t = track(over);
    return { next: t.next && `${t.next.tone}: ${t.next.headline}${t.next.action ? ` [${t.next.action}]` : ''}`, marked: t.actionable };
  }

  it('says nothing with no PR when none can be made here', () => {
    expect(next()).toEqual({ next: null, marked: false });
  });

  it('puts a failed push first', () => {
    expect(next({ pushFailed: true, pr: pr({ checks: failing }) })).toEqual({ next: 'act: Push failed [retry-push]', marked: true });
  });

  it('offers a PR, by the agent, once pushed or with commits waiting; before that only shows the way', () => {
    expect(next({ canCreatePr: true })).toEqual({ next: 'act: No PR yet [create-pr]', marked: true });
    expect(next({ canCreatePr: true, sync: { upstream: null, ahead: 0, behind: 0 } })).toEqual({ next: 'wait: Not pushed yet [create-pr]', marked: false });
    expect(next({ canCreatePr: true, sync: { ...pushed, ahead: 1 }, pr: pr({ state: 'MERGED' }) })).toEqual({ next: 'act: More work since #42 merged [create-pr]', marked: true });
  });

  it('pushes first on an open PR, and says the failed checks are on the pushed commit', () => {
    const t = track({ sync: { ...pushed, ahead: 1 }, pr: pr({ checks: failing }) });
    expect(t.next).toMatchObject({ step: 'push', headline: '1 commit not pushed', action: 'push', tone: 'act' });
    expect(t.next?.detail).toContain('ran on the last pushed commit');
  });

  it('fixes failed checks, then answers requested changes, naming who asked', () => {
    expect(next({ pr: pr({ checks: failing, reviewDecision: 'CHANGES_REQUESTED' }) })).toEqual({ next: 'act: 1 of 3 checks failed [fix-ci]', marked: true });
    const t = track({ pr: pr({ checks: green, reviewDecision: 'CHANGES_REQUESTED', reviewers: [{ login: 'alice', state: 'changes_requested' }, { login: 'bob', state: 'approved' }] }) });
    expect(t.next).toMatchObject({ headline: 'Changes requested', detail: 'From alice.', action: 'address-reviews', tone: 'act' });
  });

  it('calls for conflicts and a branch behind its base, but only waits on a draft, running checks or a review', () => {
    expect(next({ pr: pr({ checks: green, mergeState: 'dirty', baseRefName: 'main' }) })).toEqual({ next: 'act: Conflicts with main [open-pr]', marked: true });
    expect(next({ pr: pr({ checks: green, mergeState: 'behind', baseRefName: 'main' }) })).toEqual({ next: 'act: Behind main [open-pr]', marked: true });
    expect(next({ pr: pr({ checks: green, isDraft: true, mergeState: 'draft' }) })).toEqual({ next: 'wait: Draft PR [open-pr]', marked: false });
    expect(next({ pr: pr({ checks: running }) })).toEqual({ next: 'wait: Checks running', marked: false });
    expect(track({ pr: pr({ checks: green, reviewDecision: 'REVIEW_REQUIRED', requestedReviewers: ['bob', 'api-team'] }) }).next)
      .toMatchObject({ headline: 'Waiting for a review', detail: 'Asked of bob, api-team.', tone: 'wait' });
  });

  it('marks a PR GitHub says is ready, unless auto-merge will merge it', () => {
    expect(next({ pr: pr({ checks: green, reviewDecision: 'APPROVED', mergeState: 'clean' }) })).toEqual({ next: 'done: Ready to merge [merge-on-github]', marked: true });
    expect(next({ pr: pr({ checks: green, mergeState: 'clean', autoMerge: true }) })).toEqual({ next: 'wait: Merges by itself', marked: false });
    // Ready, but someone else's to merge: no mark.
    expect(next({ pr: pr({ checks: green, mergeState: 'clean', viewerIsAuthor: false }) })).toEqual({ next: 'done: Ready to merge [merge-on-github]', marked: false });
  });

  it('colours the merge step, and the lozenge, by GitHub\'s verdict', () => {
    const conflicts = track({ pr: pr({ checks: green, reviewDecision: 'APPROVED', mergeState: 'dirty' }) });
    expect(conflicts.steps[4]).toMatchObject({ state: 'attention', detail: 'conflicts' });
    expect(conflicts.stage.state).toBe('attention');
    expect(track({ pr: pr({ checks: green, mergeState: 'behind' }) }).steps[4]).toMatchObject({ state: 'attention', detail: 'behind its base' });
    expect(track({ pr: pr({ checks: green, mergeState: 'clean' }) }).steps[4]).toMatchObject({ state: 'next', detail: 'ready' });
    expect(track({ pr: pr({ checks: green, mergeState: 'blocked' }) }).steps[4].state).toBe('todo');
  });

  it('waits on a rule or on GitHub\'s verdict, and finishes on a merged PR', () => {
    expect(next({ pr: pr({ checks: green, mergeState: 'blocked' }) })).toEqual({ next: 'wait: Blocked [open-pr]', marked: false });
    expect(next({ pr: pr({ checks: green }) })).toEqual({ next: 'wait: Waiting for GitHub [open-pr]', marked: false });
    expect(next({ pr: pr({ state: 'MERGED' }) })).toEqual({ next: 'done: #42 merged', marked: false });
    expect(next({ pr: pr({ state: 'MERGED' }), canCreatePr: true })).toEqual({ next: 'done: #42 merged [create-pr]', marked: false });
    expect(next({ pr: pr({ state: 'CLOSED' }), canCreatePr: true })).toEqual({ next: 'wait: #42 closed without merging [create-pr]', marked: false });
  });
});
