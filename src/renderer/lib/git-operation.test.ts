import { describe, it, expect } from 'vitest';
import { operationNext, operationShort, operationTitle } from './git-operation.js';

describe('git operation wording', () => {
  it('names each kind, with what git told us', () => {
    expect(operationTitle({ kind: 'rebase', branch: 'feat', incoming: 'main', step: 1, total: 2 })).toBe('Rebasing feat onto main, step 1 of 2');
    expect(operationTitle({ kind: 'merge', incoming: 'main', branch: 'feat' })).toBe('Merging main into feat');
    expect(operationTitle({ kind: 'cherry-pick', commit: '1a2b3c4' })).toBe('Cherry-picking 1a2b3c4');
    expect(operationTitle({ kind: 'revert', commit: '1a2b3c4' })).toBe('Reverting 1a2b3c4');
  });

  it('still reads when git told us less (a detached head, an unnamed commit)', () => {
    expect(operationTitle({ kind: 'rebase' })).toBe('Rebasing');
    expect(operationTitle({ kind: 'merge' })).toBe('Merging a branch');
    expect(operationShort({ kind: 'rebase' })).toBe('rebasing');
  });

  it('gives the status bar a short word', () => {
    expect(operationShort({ kind: 'rebase', step: 2, total: 3 })).toBe('rebasing 2/3');
    expect(operationShort({ kind: 'cherry-pick' })).toBe('cherry-picking');
  });

  it('says what is left: a merge ends with a commit, the others with Continue', () => {
    expect(operationNext({ kind: 'rebase' }, 2)).toBe('Resolve 2 conflicts, then continue.');
    expect(operationNext({ kind: 'merge' }, 1)).toBe('Resolve 1 conflict, then commit.');
    expect(operationNext({ kind: 'merge' }, 0)).toBe('All conflicts resolved: commit to finish the merge.');
    expect(operationNext({ kind: 'revert' }, 0)).toBe('All conflicts resolved: continue the revert.');
  });

  it('points to Uncommitted to commit a merge from the Branch view', () => {
    expect(operationNext({ kind: 'merge' }, 0, true)).toBe('All conflicts resolved: commit in Uncommitted to finish the merge.');
    expect(operationNext({ kind: 'rebase' }, 0, true)).toBe('All conflicts resolved: continue the rebase.');
  });

  it('says what Continue and Abort do between two of several picks', () => {
    expect(operationNext({ kind: 'cherry-pick', passesOver: '5d1c780' }, 0)).toBe("git hasn't picked 5d1c780, and continuing skips it. To pick it, abort and start again.");
    expect(operationNext({ kind: 'revert', passesOver: '5d1c780' }, 0)).toBe("git hasn't reverted 5d1c780, and continuing skips it. To revert it, abort and start again.");
    expect(operationNext({ kind: 'cherry-pick', byHand: true }, 0)).toBe('A commit was made by hand part way: continue to pick the rest, or run git cherry-pick --quit in the terminal to stop here.');
  });
});
