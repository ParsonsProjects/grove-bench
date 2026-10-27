import type { GitSyncStatus, PrInfo } from '../../shared/types.js';

/**
 * The branch lozenge's ship track: where a thread's branch is on its way to
 * merged, as five steps (push, PR, checks, review, merge), each drawn as a
 * dot on the lozenge and named in its popup. `actionable` puts the green
 * mark on the lozenge: there is something in the popup for you to do now.
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

export interface ShipTrack {
  steps: ShipStep[];
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
  return { steps, actionable, summary: summary || 'nothing to push yet' };
}
