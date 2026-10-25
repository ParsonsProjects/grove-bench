import type { GitOperation } from '../../shared/types.js';

/** A merge, rebase, cherry-pick or revert stopped part way, as the Changes
 *  tab and the status bar name it. */

/** "Rebasing feat onto main, step 1 of 2", "Merging main into feat". */
export function operationTitle(op: GitOperation): string {
  switch (op.kind) {
    case 'merge':
      return `Merging ${op.incoming ?? 'a branch'}${op.branch ? ` into ${op.branch}` : ''}`;
    case 'rebase': {
      const step = op.step && op.total ? `, step ${op.step} of ${op.total}` : '';
      return `Rebasing${op.branch ? ` ${op.branch}` : ''}${op.incoming ? ` onto ${op.incoming}` : ''}${step}`;
    }
    case 'cherry-pick':
      return `Cherry-picking ${op.commit ?? 'a commit'}`;
    case 'revert':
      return `Reverting ${op.commit ?? 'a commit'}`;
  }
}

/** The status bar's word for it: "rebasing 1/2", "merging". */
export function operationShort(op: GitOperation): string {
  switch (op.kind) {
    case 'merge': return 'merging';
    case 'rebase': return op.step && op.total ? `rebasing ${op.step}/${op.total}` : 'rebasing';
    case 'cherry-pick': return 'cherry-picking';
    case 'revert': return 'reverting';
  }
}

/** What to do next: resolve what's left, then finish it (a merge with a
 *  commit, in Uncommitted, the others with Continue). Between two of several
 *  picks, what Continue and Abort will do there. */
export function operationNext(op: GitOperation, conflicts: number, inBranchView = false): string {
  const finish = op.kind === 'merge' ? 'commit' : 'continue';
  if (conflicts > 0) return `Resolve ${conflicts} conflict${conflicts === 1 ? '' : 's'}, then ${finish}.`;
  const [verb, done] = op.kind === 'revert' ? ['revert', 'reverted'] : ['pick', 'picked'];
  if (op.byHand) return `A commit was made by hand part way: continue to ${verb} the rest, or run git ${op.kind} --quit in the terminal to stop here.`;
  if (op.passesOver) return `git hasn't ${done} ${op.passesOver}, and continuing skips it. To ${verb} it, abort and start again.`;
  if (op.kind === 'merge') return `All conflicts resolved: commit${inBranchView ? ' in Uncommitted' : ''} to finish the merge.`;
  return `All conflicts resolved: continue the ${op.kind}.`;
}
