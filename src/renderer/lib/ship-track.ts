import type { GitSyncStatus, PrInfo } from '../../shared/types.js';

/**
 * The branch lozenge's ship track: where a thread's branch is on its way to
 * merged, as five steps (push, PR, checks, review, merge), each named with
 * a dot in the lozenge's popup. `stage` sums them up as the lozenge's one
 * icon. `actionable` puts the green mark on the lozenge: there is something
 * in the popup for you to do now.
 */

export type ShipStepId = 'push' | 'pr' | 'checks' | 'review' | 'merge';

/** done: green. next: the step to take now, hollow and bright. running:
 *  blue, moving. failed: red. attention: amber, waiting on you. merged:
 *  purple, as a merged PR is. closed: grey. todo: hollow and faint. */
export type ShipStepState = 'done' | 'next' | 'running' | 'failed' | 'attention' | 'merged' | 'closed' | 'todo';

export interface ShipStep {
  id: ShipStepId;
  label: string;
  state: ShipStepState;
  /** What the step stands at, in words, for the popup. Empty when there's
   *  nothing to say yet. */
  detail: string;
}

/** The lozenge's icon shape, how far the branch has got: a branch until
 *  there is a PR, then the PR as it stands. */
export type ShipStageIcon = 'branch' | 'draft' | 'pr' | 'merged' | 'closed';

/** The icon's colour, the step that matters most now: a failure, then one
 *  waiting on you, then one running, then how the PR ended. done (green)
 *  once every step before the merge is and the PR isn't a draft, which
 *  can't be merged yet; todo (plain) otherwise. */
export type ShipStageState = Exclude<ShipStepState, 'next'>;

export interface ShipStage {
  icon: ShipStageIcon;
  state: ShipStageState;
}

/** What the Next notice offers: an action this app takes, a page on
 *  GitHub, or nothing while waiting. */
export type ShipAction = 'retry-push' | 'push' | 'create-pr' | 'fix-ci' | 'address-reviews' | 'merge-on-github' | 'open-pr';

/** The one thing to do now, for the popup's Next notice. act: something
 *  for you to do (the lozenge's green mark). wait: nothing to do but wait.
 *  done: finished, or ready for you to finish on GitHub. */
export interface ShipNext {
  step: ShipStepId;
  headline: string;
  detail?: string;
  action?: ShipAction;
  tone: 'act' | 'wait' | 'done';
}

export interface ShipTrack {
  steps: ShipStep[];
  stage: ShipStage;
  /** Null when there's nothing to say: no PR, and none can be made here. */
  next: ShipNext | null;
  actionable: boolean;
  /** The steps in one line, for the lozenge's tooltip and screen readers. */
  summary: string;
}

export interface ShipTrackInput {
  sync: GitSyncStatus;
  /** The PR the thread follows (prStore.getPr), if any. */
  pr: PrInfo | null | undefined;
  /** The last push failed and the error is still standing. */
  pushFailed: boolean;
  /** A PR can be created from here (gh is available and none exists). */
  canCreatePr: boolean;
}

/** "1 commit", "2 commits". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function shipTrack({ sync, pr, pushFailed, canCreatePr }: ShipTrackInput): ShipTrack {
  const open = pr?.state === 'OPEN' || (!!pr && !pr.state);
  const pushed = !!sync.upstream && sync.ahead === 0 && !pushFailed;

  // A branch that was never pushed reports nothing ahead (there is no
  // upstream to count against), so it can't be told apart from one with
  // nothing to push: neither gets the green mark for pushing.
  const push: ShipStep = pushFailed
    ? { id: 'push', label: 'Push', state: 'failed', detail: 'push failed' }
    : sync.ahead > 0
      ? { id: 'push', label: 'Push', state: 'next', detail: `${plural(sync.ahead, 'commit')} to push` }
      : !sync.upstream
        ? { id: 'push', label: 'Push', state: pr ? 'done' : 'todo', detail: pr ? '' : 'not pushed yet' }
        : { id: 'push', label: 'Push', state: 'done', detail: sync.behind > 0 ? `up to date, ${sync.behind} behind` : 'up to date' };

  const prStep: ShipStep = !pr
    ? { id: 'pr', label: 'PR', state: canCreatePr && pushed ? 'next' : 'todo', detail: canCreatePr ? 'none yet' : '' }
    : pr.state === 'CLOSED'
      ? { id: 'pr', label: 'PR', state: 'closed', detail: `#${pr.number} closed` }
      : { id: 'pr', label: 'PR', state: 'done', detail: `#${pr.number} ${pr.state === 'MERGED' ? 'merged' : pr.isDraft ? 'draft' : 'open'}` };

  const checks = pr?.checks;
  const checksStep: ShipStep = !pr || !checks
    ? { id: 'checks', label: 'Checks', state: pr ? 'done' : 'todo', detail: pr ? 'none reported' : '' }
    : checks.failed > 0
      ? { id: 'checks', label: 'Checks', state: open ? 'failed' : 'closed', detail: `${checks.failed} of ${checks.total} failed${checks.pending > 0 ? `, ${checks.pending} running` : ''}` }
      : checks.pending > 0
        ? { id: 'checks', label: 'Checks', state: open ? 'running' : 'closed', detail: `${checks.passed} of ${checks.total} passed, ${checks.pending} running` }
        : { id: 'checks', label: 'Checks', state: 'done', detail: `${checks.passed} passed` };

  const review: ShipStep = !pr
    ? { id: 'review', label: 'Review', state: 'todo', detail: '' }
    : pr.reviewDecision === 'APPROVED'
      ? { id: 'review', label: 'Review', state: 'done', detail: 'approved' }
      : pr.reviewDecision === 'CHANGES_REQUESTED'
        ? { id: 'review', label: 'Review', state: open ? 'attention' : 'closed', detail: 'changes requested' }
        : pr.reviewDecision === 'REVIEW_REQUIRED'
          ? { id: 'review', label: 'Review', state: open ? 'todo' : 'closed', detail: 'review required' }
          : { id: 'review', label: 'Review', state: 'done', detail: 'none required' };

  // GitHub's verdict on an open PR: conflicts or a branch behind its base
  // wait on you; nothing in the way makes merging the step to take.
  const merge: ShipStep = pr?.state === 'MERGED'
    ? { id: 'merge', label: 'Merge', state: 'merged', detail: 'merged' }
    : pr?.state === 'CLOSED'
      ? { id: 'merge', label: 'Merge', state: 'closed', detail: 'closed without merging' }
      : open && (pr?.mergeState === 'dirty' || pr?.mergeState === 'behind')
        ? { id: 'merge', label: 'Merge', state: 'attention', detail: pr.mergeState === 'dirty' ? 'conflicts' : 'behind its base' }
        : open && !pr?.isDraft && (pr?.mergeState === 'clean' || pr?.mergeState === 'has_hooks' || pr?.mergeState === 'unstable')
          ? { id: 'merge', label: 'Merge', state: 'next', detail: 'ready' }
          : { id: 'merge', label: 'Merge', state: 'todo', detail: '' };

  const steps = [push, prStep, checksStep, review, merge];
  const has = (state: ShipStepState) => steps.some((s) => s.state === state);
  const stage: ShipStage = {
    icon: !pr ? 'branch' : pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'pr',
    state: has('failed') ? 'failed'
      : has('attention') ? 'attention'
      : has('running') ? 'running'
      : pr?.state === 'MERGED' ? 'merged'
      : pr?.state === 'CLOSED' ? 'closed'
      : !pr?.isDraft && [push, prStep, checksStep, review].every((s) => s.state === 'done') ? 'done'
      : 'todo',
  };
  const next = nextStep({ sync, pr, pushFailed, canCreatePr }, open, pushed);
  // The green mark: something to do now, or a PR GitHub says is ready that
  // you merge (Grove doesn't). Not for one someone else opened, such as a PR
  // you watch to another repository: its author or a maintainer merges it.
  const actionable = !!next && (next.tone === 'act' || (next.action === 'merge-on-github' && pr?.viewerIsAuthor !== false));
  const summary = [
    push.detail,
    pr ? `PR ${prStep.detail}` : canCreatePr ? 'no PR yet' : '',
    pr && checks ? `checks: ${checksStep.detail}` : '',
    pr?.reviewDecision ? review.detail : '',
  ].filter(Boolean).join(', ');
  return { steps, stage, next, actionable, summary: summary || 'nothing to push yet' };
}

function nextStep({ sync, pr, pushFailed, canCreatePr }: ShipTrackInput, open: boolean, pushed: boolean): ShipNext | null {
  const base = pr?.baseRefName ?? 'the base branch';
  if (pushFailed) return { step: 'push', headline: 'Push failed', detail: 'The error is below.', action: 'retry-push', tone: 'act' };

  if (!open) {
    if (canCreatePr && (sync.ahead > 0 || (!pr && pushed))) {
      return {
        step: 'pr',
        headline: pr ? `More work since #${pr.number} ${pr.state === 'MERGED' ? 'merged' : 'closed'}` : 'No PR yet',
        detail: 'The agent commits, pushes and opens one.',
        action: 'create-pr',
        tone: 'act',
      };
    }
    if (sync.ahead > 0) return { step: 'push', headline: `${plural(sync.ahead, 'commit')} not pushed`, action: 'push', tone: 'act' };
    if (pr?.state === 'MERGED') {
      return { step: 'merge', headline: `#${pr.number} merged`, ...(canCreatePr ? { detail: 'For more work on this branch, open a new PR.', action: 'create-pr' as const } : {}), tone: 'done' };
    }
    if (pr?.state === 'CLOSED') {
      return { step: 'merge', headline: `#${pr.number} closed without merging`, ...(canCreatePr ? { detail: 'Open a new PR for more work on this branch.', action: 'create-pr' as const } : {}), tone: 'wait' };
    }
    // Not pushed yet: nothing to call for, but the way there.
    return canCreatePr ? { step: 'pr', headline: 'Not pushed yet', detail: 'When the work is ready, the agent can commit, push and open a PR.', action: 'create-pr', tone: 'wait' } : null;
  }

  const checks = pr!.checks;
  if (sync.ahead > 0) {
    return {
      step: 'push',
      headline: `${plural(sync.ahead, 'commit')} not pushed`,
      detail: checks && checks.failed > 0 ? 'The failed checks ran on the last pushed commit. Push to check this one.' : 'Push to run the checks on them.',
      action: 'push',
      tone: 'act',
    };
  }
  if (checks && checks.failed > 0) {
    return { step: 'checks', headline: `${checks.failed} of ${plural(checks.total, 'check')} failed`, action: 'fix-ci', tone: 'act' };
  }
  if (pr!.reviewDecision === 'CHANGES_REQUESTED') {
    const from = (pr!.reviewers ?? []).filter((r) => r.state === 'changes_requested').map((r) => r.login);
    return { step: 'review', headline: 'Changes requested', ...(from.length ? { detail: `From ${from.join(', ')}.` } : {}), action: 'address-reviews', tone: 'act' };
  }
  if (pr!.mergeState === 'dirty') {
    return { step: 'merge', headline: `Conflicts with ${base}`, detail: `Merge ${base} into the branch and resolve them, then push.`, action: 'open-pr', tone: 'act' };
  }
  if (pr!.isDraft) return { step: 'pr', headline: 'Draft PR', detail: 'Mark it ready for review on GitHub when the work is done.', action: 'open-pr', tone: 'wait' };
  if (checks && checks.pending > 0) {
    return { step: 'checks', headline: 'Checks running', detail: `${checks.passed} of ${checks.total} passed.`, tone: 'wait' };
  }
  if (pr!.mergeState === 'behind') {
    return { step: 'merge', headline: `Behind ${base}`, detail: `${base} has moved on. Update the branch before merging.`, action: 'open-pr', tone: 'act' };
  }
  if (pr!.reviewDecision === 'REVIEW_REQUIRED') {
    const asked = pr!.requestedReviewers ?? [];
    return { step: 'review', headline: 'Waiting for a review', detail: asked.length ? `Asked of ${asked.join(', ')}.` : `${base} needs an approving review to merge.`, tone: 'wait' };
  }
  if (pr!.autoMerge) return { step: 'merge', headline: 'Merges by itself', detail: 'Auto-merge is on: GitHub merges it once nothing stops it.', tone: 'wait' };
  if (pr!.mergeState === 'clean' || pr!.mergeState === 'has_hooks' || pr!.mergeState === 'unstable') {
    return { step: 'merge', headline: 'Ready to merge', action: 'merge-on-github', tone: 'done' };
  }
  if (pr!.mergeState === 'blocked') return { step: 'merge', headline: 'Blocked', detail: 'A branch rule stops the merge: see the PR on GitHub.', action: 'open-pr', tone: 'wait' };
  // GitHub hasn't given a verdict yet (unknown, or none).
  return { step: 'merge', headline: 'Waiting for GitHub', detail: 'It hasn\'t said yet whether the PR can merge.', action: 'open-pr', tone: 'wait' };
}
