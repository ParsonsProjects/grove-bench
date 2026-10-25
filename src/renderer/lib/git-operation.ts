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
 *  commit, the others with Continue). */
export function operationNext(op: GitOperation, conflicts: number): string {
  const finish = op.kind === 'merge' ? 'commit' : 'continue';
  if (conflicts > 0) return `Resolve ${conflicts} conflict${conflicts === 1 ? '' : 's'}, then ${finish}.`;
  return op.kind === 'merge' ? 'All conflicts resolved: commit to finish the merge.' : `All conflicts resolved: continue the ${op.kind}.`;
}
