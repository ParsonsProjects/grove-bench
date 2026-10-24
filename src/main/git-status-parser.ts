import type { GitFileStatus, GitStatusEntry, GitStatusResult } from '../shared/types.js';
import { isConflictCode } from '../shared/git-conflicts.js';

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

const isRenameOrCopy = (c: string) => c === 'R' || c === 'C';

/** One record of `git status --porcelain=v1 -z`: its status code (index
 *  column, then worktree column), its path, and a rename or copy's old path. */
export interface PorcelainRecord { xy: string; path: string; origPath?: string }

/**
 * The records of `git status --porcelain=v1 -z`, "XY path\0". A rename or
 * copy, in either column, has the old path as a field of its own:
 * "XY newpath\0oldpath\0". A rename in the worktree column (" R") is a file
 * added with `git add -N`.
 */
export function porcelainRecords(raw: string): PorcelainRecord[] {
  const parts = raw.split('\0');
  const records: PorcelainRecord[] = [];
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (record.length < 3) continue;
    const xy = record.slice(0, 2);
    records.push({ xy, path: record.slice(3), ...(isRenameOrCopy(xy[0]) || isRenameOrCopy(xy[1]) ? { origPath: parts[++i] } : {}) });
  }
  return records;
}

/** Parse the output of `git status --porcelain=v1 -z` into GitStatusResult:
 *  an entry for each column with a change, and one for a file in conflict
 *  (both columns of its code describe the conflict). */
export function parseGitStatusPorcelain(raw: string): GitStatusResult {
  const entries: GitStatusEntry[] = [];
  for (const { xy, path: filePath, origPath } of porcelainRecords(raw)) {
    const [x, y] = xy; // index (staged), then worktree (unstaged)
    if (xy === '??') {
      entries.push({ filePath, status: 'untracked', staged: false });
      continue;
    }
    if (isConflictCode(xy)) {
      entries.push({ filePath, status: 'conflicted', staged: false, conflict: xy });
      continue;
    }
    if (x !== ' ' && x !== '?') {
      entries.push({ filePath, status: mapStatus(x), staged: true, ...(origPath && isRenameOrCopy(x) ? { origPath } : {}) });
    }
    if (y !== ' ' && y !== '?') {
      entries.push({ filePath, status: mapStatus(y), staged: false, ...(origPath && isRenameOrCopy(y) ? { origPath } : {}) });
    }
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
 * Parse the output of `git diff --numstat -z`. Each record is
 * "additions\tdeletions\tpath\0"; a rename or copy leaves the path empty and
 * follows it with "oldpath\0newpath\0", and is listed under its new path.
 * Binary changes use "-" for both counts. Without -z, git quotes names
 * outside ASCII and writes a rename as "a => b".
 */
export function parseNumstat(raw: string): DiffStat[] {
  const parts = raw.split('\0');
  const out: DiffStat[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    let path = m[3];
    if (!path) {
      path = parts[i + 2] ?? '';
      i += 2;
    }
    if (!path) continue;
    const binary = m[1] === '-' || m[2] === '-';
    out.push({ path, additions: binary ? 0 : Number(m[1]), deletions: binary ? 0 : Number(m[2]), binary });
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

const ZERO_OID = /^0+$/;

/**
 * Parse `git diff --raw -z --no-abbrev <from> <to>`. Each record is
 * ":oldmode newmode oldsha newsha STATUS\0path\0" (renames/copies carry a
 * score and two paths). The new-side blob id doubles as the content hash the
 * UI uses for "changed since viewed", so it is attached here.
 */
export function parseDiffRaw(raw: string): GitStatusEntry[] {
  if (!raw) return [];
  const parts = raw.split('\0');
  const entries: GitStatusEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const meta = parts[i];
    if (!meta.startsWith(':')) { i++; continue; }
    const fields = meta.slice(1).split(' ');
    if (fields.length < 5) { i++; continue; }
    const newSha = fields[3];
    const code = fields[4];
    const kind = code[0];
    const contentHash = ZERO_OID.test(newSha) ? 'deleted' : newSha;
    if (kind === 'R' || kind === 'C') {
      const origPath = parts[i + 1];
      const filePath = parts[i + 2];
      if (filePath) entries.push({ filePath, status: mapStatus(kind), staged: false, origPath, contentHash });
      i += 3;
      continue;
    }
    const filePath = parts[i + 1];
    if (filePath) entries.push({ filePath, status: mapStatus(kind), staged: false, contentHash });
    i += 2;
  }
  return entries;
}
