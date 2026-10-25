import { describe, it, expect } from 'vitest';
import { conflictMarkers, conflictSideLabel } from './conflict-markers.js';
import { parseDiffLines } from './diff-parse.js';

// What `git diff HEAD` shows for a file a rebase stopped on (git 2.43, zdiff3).
const REBASE_PATCH = `diff --git a/f.txt b/f.txt
index af70335..49154f8 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,9 @@
 a
+<<<<<<< HEAD
 MAIN
+||||||| parent of 5150b6c (feat change)
+b
+=======
+FEAT
+>>>>>>> 5150b6c (feat change)
 c
`;

describe('conflictMarkers', () => {
  it('finds each marker by its line in the file', () => {
    expect([...conflictMarkers(parseDiffLines(REBASE_PATCH))]).toEqual([
      [2, 'ours'], [4, 'base'], [6, 'separator'], [8, 'theirs'],
    ]);
  });

  it('finds them in a file with CRLF endings, which git gives its markers too', () => {
    const crlf = REBASE_PATCH.split('\n').map((l, i) => (i >= 5 && l ? `${l}\r` : l)).join('\n');
    expect([...conflictMarkers(parseDiffLines(crlf))]).toEqual([
      [2, 'ours'], [4, 'base'], [6, 'separator'], [8, 'theirs'],
    ]);
  });

  it('leaves an ======= or ||||||| outside a conflict alone, and markers already in HEAD', () => {
    const lines = parseDiffLines(`diff --git a/n.md b/n.md
--- a/n.md
+++ b/n.md
@@ -1,2 +1,5 @@
 Title
+=======
+|||||||
 <<<<<<< HEAD
+>>>>>>> main
`);
    // The <<<<<<< is a context line, so it opens nothing. The >>>>>>> on its
    // own still counts: it keeps the file from being marked resolved.
    expect([...conflictMarkers(lines)]).toEqual([[5, 'theirs']]);
  });

  it('needs the marker to be the whole run of seven, and ends the block at >>>>>>>', () => {
    const lines = parseDiffLines(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -0,0 +1,5 @@
+<<<<<<<< eight
+<<<<<<< HEAD
+======= not alone
+>>>>>>> main
+=======
`);
    expect([...conflictMarkers(lines)]).toEqual([[2, 'ours'], [4, 'theirs']]);
  });
});

describe('conflictSideLabel', () => {
  const rebase = { kind: 'rebase' as const, branch: 'feat', incoming: 'main', step: 1, total: 2 };

  it("names a rebase's sides the right way round: HEAD is the branch it goes onto", () => {
    expect(conflictSideLabel('ours', rebase)).toBe("main, the branch you're rebasing onto");
    expect(conflictSideLabel('ours', { ...rebase, step: 2 })).toBe("main, the branch you're rebasing onto, with your earlier commits");
    expect(conflictSideLabel('theirs', rebase)).toBe('your commit');
  });

  it('names a merge, cherry-pick and revert', () => {
    const merge = { kind: 'merge' as const, branch: 'feat', incoming: 'main' };
    expect(conflictSideLabel('ours', merge)).toBe('feat, yours');
    expect(conflictSideLabel('theirs', merge)).toBe('coming in');
    expect(conflictSideLabel('ours', { kind: 'cherry-pick', branch: 'feat', commit: 'b4f4a44' })).toBe('feat, yours');
    expect(conflictSideLabel('theirs', { kind: 'cherry-pick', commit: 'b4f4a44' })).toBe('the commit being picked');
    expect(conflictSideLabel('theirs', { kind: 'revert', commit: 'b4f4a44' })).toBe('what the revert puts back');
  });

  it('names the common ancestor whatever is under way, and nothing for the separator', () => {
    expect(conflictSideLabel('base', undefined)).toBe('what both sides started from');
    expect(conflictSideLabel('separator', rebase)).toBeNull();
  });

  it('adds nothing to what git wrote when nothing is under way (a stash pop)', () => {
    expect(conflictSideLabel('ours', undefined)).toBeNull();
    expect(conflictSideLabel('theirs', undefined)).toBeNull();
  });

  it('still reads when git told us less', () => {
    expect(conflictSideLabel('ours', { kind: 'rebase' })).toBe("the branch you're rebasing onto");
    expect(conflictSideLabel('ours', { kind: 'merge' })).toBe('yours');
  });
});
