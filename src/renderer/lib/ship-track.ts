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
 *  once every step before the merge is; todo (plain) while one is to come. */
export type ShipStageState = Exclude<ShipStepState, 'next'>;

export interface ShipStage {
  icon: ShipStageIcon;
  state: ShipStageState;
}

export interface ShipTrack {
  steps: ShipStep[];
  stage: ShipStage;
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

  const merge: ShipStep = pr?.state === 'MERGED'
    ? { id: 'merge', label: 'Merge', state: 'merged', detail: 'merged' }
    : pr?.state === 'CLOSED'
      ? { id: 'merge', label: 'Merge', state: 'closed', detail: 'closed without merging' }
      : { id: 'merge', label: 'Merge', state: 'todo', detail: '' };

  const steps = [push, prStep, checksStep, review, merge];
  const states = steps.map((s) => s.state);
  // Merged before closed: a merged PR's failed checks are greyed as closed.
  const stage: ShipStage = {
    icon: !pr ? 'branch' : pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'pr',
    state: (['failed', 'attention', 'running', 'merged', 'closed'] as const).find((s) => states.includes(s))
      ?? (states.slice(0, 4).every((s) => s === 'done') ? 'done' : 'todo'),
  };
  const actionable = pushFailed
    || sync.ahead > 0
    || prStep.state === 'next'
    || (open && checksStep.state === 'failed')
    || (open && review.state === 'attention');
  const summary = [
    push.detail,
    pr ? `PR ${prStep.detail}` : canCreatePr ? 'no PR yet' : '',
    pr && checks ? `checks: ${checksStep.detail}` : '',
    pr?.reviewDecision ? review.detail : '',
  ].filter(Boolean).join(', ');
  return { steps, stage, actionable, summary: summary || 'nothing to push yet' };
}
