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

export interface DiffStat {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse the output of `git diff --numstat`. Each line is "additions\tdeletions\tpath";
 * binary changes use "-" for both counts. Paths may themselves contain tabs.
 */
export function parseNumstat(raw: string): DiffStat[] {
  if (!raw) return [];
  const out: DiffStat[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const addStr = parts[0];
    const delStr = parts[1];
    const path = parts.slice(2).join('\t');
    const binary = addStr === '-' || delStr === '-';
    out.push({
      path,
      additions: binary ? 0 : (parseInt(addStr, 10) || 0),
      deletions: binary ? 0 : (parseInt(delStr, 10) || 0),
      binary,
    });
  }
  return out;
}

/**
 * Parse `git diff --name-status -z <ref>` (working tree vs a commit). Records
 * are "STATUS\0path\0"; renames and copies carry a score and two paths:
 * "R100\0oldpath\0newpath\0". Entries are unstaged from the UI's point of
 * view: the branch scope has no staging concept.
 */
export function parseNameStatus(raw: string): GitStatusEntry[] {
  if (!raw) return [];
  const parts = raw.split('\0');
  const entries: GitStatusEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i];
    if (!code) { i++; continue; }
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const origPath = parts[i + 1];
      const filePath = parts[i + 2];
      if (filePath) entries.push({ filePath, status: mapStatus(kind), staged: false, origPath });
      i += 3;
      continue;
    }
    const filePath = parts[i + 1];
    if (filePath) entries.push({ filePath, status: mapStatus(kind), staged: false });
    i += 2;
  }
  return entries;
}

/** Parse `git hash-object --stdin-paths` output (one hash per input path, in order). */
export function parseHashObjectOutput(raw: string, paths: string[]): Map<string, string> {
  const hashes = raw.split('\n').map(h => h.trim()).filter(Boolean);
  const out = new Map<string, string>();
  paths.forEach((p, idx) => { if (hashes[idx]) out.set(p, hashes[idx]); });
  return out;
}
