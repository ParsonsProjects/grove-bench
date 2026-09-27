/** Rows for the status bar branch picker. */
export interface BranchPickerRows {
  /** Branches whose name contains every space-separated token of the query,
   *  the current branch first. */
  matches: string[];
  /** The typed name, offered as "Create branch" when no branch has exactly
   *  that name and it could be one (no spaces, no leading dash). Full
   *  validation (`git check-ref-format`) happens in the main process. */
  createName: string | null;
}

export function branchPickerRows(branches: string[], query: string, current: string): BranchPickerRows {
  const q = query.trim();
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = branches
    .filter((b) => tokens.every((t) => b.toLowerCase().includes(t)))
    .sort((a, b) => (a === current ? -1 : b === current ? 1 : 0));
  const createName = q && !/\s/.test(q) && !q.startsWith('-') && !branches.includes(q) ? q : null;
  return { matches, createName };
}
