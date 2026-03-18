import type { GitFileStatus, GitStatusEntry, GitStatusResult } from '../shared/types.js';

function mapStatus(c: string): GitFileStatus {
  switch (c) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    default: return 'modified';
  }
}

/**
 * Parse the output of `git status --porcelain=v1 -z` into GitStatusResult.
 * The -z flag produces NUL-delimited records where renames/copies have
 * two NUL-separated fields: "XY newpath\0oldpath".
 */
export function parseGitStatusPorcelain(raw: string): GitStatusResult {
  if (!raw) return { entries: [] };

  const entries: GitStatusEntry[] = [];
  const parts = raw.split('\0').filter(Boolean);

  let i = 0;
  while (i < parts.length) {
    const record = parts[i];
    if (record.length < 3) { i++; continue; }

    const x = record[0]; // index (staged) status
    const y = record[1]; // worktree (unstaged) status
    const filePath = record.slice(3);

    if (x === '?' && y === '?') {
      entries.push({ filePath, status: 'untracked', staged: false });
      i++;
      continue;
    }

    // Renames and copies have the old path as the next NUL-separated field
    const isRenameOrCopy = x === 'R' || x === 'C';
    let origPath: string | undefined;
    if (isRenameOrCopy) {
      i++;
      origPath = parts[i];
    }

    // Staged change (index column)
    if (x !== ' ' && x !== '?') {
      entries.push({ filePath, status: mapStatus(x), staged: true, ...(origPath ? { origPath } : {}) });
    }

    // Unstaged change (worktree column)
    if (y !== ' ' && y !== '?') {
      entries.push({ filePath, status: mapStatus(y), staged: false });
    }

    i++;
  }

  return { entries };
}
