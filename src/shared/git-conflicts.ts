/**
 * Files a merge, rebase or cherry-pick left in conflict, as
 * `git status --porcelain` codes them: both columns of the code describe one
 * unmerged file, and git-status names each case (its "Short Format" table).
 * "Us" is the branch checked out, so in a rebase it is the branch being
 * rebased onto.
 */
export const CONFLICT_KINDS = {
  DD: 'both deleted',
  AU: 'added by us',
  UD: 'deleted by them',
  UA: 'added by them',
  DU: 'deleted by us',
  AA: 'both added',
  UU: 'both modified',
} as const;

export type GitConflictCode = keyof typeof CONFLICT_KINDS;

export function isConflictCode(xy: string): xy is GitConflictCode {
  return Object.hasOwn(CONFLICT_KINDS, xy);
}

/** Whether a line is one git writes where a conflict starts or ends
 *  ("<<<<<<< HEAD", ">>>>>>> main"). The "=======" between the two sides is
 *  left out: a Markdown heading can be underlined with it. */
export function isConflictMarker(line: string): boolean {
  return /^(<{7}|>{7})(?: |$)/.test(line);
}
