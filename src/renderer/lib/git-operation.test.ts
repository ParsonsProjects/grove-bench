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
});
