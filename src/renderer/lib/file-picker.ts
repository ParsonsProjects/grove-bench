/**
 * Results for the @ file picker: what to show before anything is typed, and
 * how typed queries are ranked.
 */
import type Fuse from 'fuse.js';

export interface FileEntry {
  /** As listed: folders end with '/'. */
  path: string;
  filename: string;
  isDir: boolean;
  // Lowercased once, for ranking on every keystroke.
  lpath: string;
  lname: string;
  /** Filename without its last extension (`git` for `git.ts`). */
  lstem: string;
}

export interface PickerItem {
  entry: FileEntry;
  /** Heading shown above the first item of each group (empty query only). */
  group?: 'Changed' | 'Project';
}

export interface PickerResults {
  items: PickerItem[];
  /** Matches not shown. */
  more: number;
  /** `more` is a lower bound (fuzzy matching stopped at its cap). */
  moreIsLowerBound: boolean;
}

/** Rows shown at once; the list scrolls. */
export const PICKER_LIMIT = 50;
/** Fuzzy matches considered after the substring matches. */
const FUZZY_LIMIT = 200;

export function toEntries(paths: string[]): FileEntry[] {
  return paths.map((p) => {
    const isDir = p.endsWith('/');
    const clean = isDir ? p.slice(0, -1) : p;
    const filename = clean.split('/').pop() ?? clean;
    const lname = filename.toLowerCase();
    const dot = lname.lastIndexOf('.');
    return {
      path: p,
      filename,
      isDir,
      lpath: p.toLowerCase(),
      lname,
      lstem: dot > 0 ? lname.slice(0, dot) : lname,
    };
  });
}

const TEST_FILE = /\.(test|spec)\./;

/** Within a tier: source before tests, short names, then shallow paths. */
function byRelevance(a: FileEntry, b: FileEntry): number {
  return (Number(TEST_FILE.test(a.lname)) - Number(TEST_FILE.test(b.lname)))
    || (a.lname.length - b.lname.length)
    || (a.path.length - b.path.length)
    || a.path.localeCompare(b.path);
}

/** 0: exact name, 1: name prefix, 2: name contains, 3: path contains, -1: none. */
function tierOf(e: FileEntry, q: string): number {
  if (e.lname === q || e.lstem === q) return 0;
  if (e.lname.startsWith(q)) return 1;
  if (e.lname.includes(q)) return 2;
  if (e.lpath.includes(q)) return 3;
  return -1;
}

/**
 * Rank files for a typed query: exact filename, filename prefix, filename
 * substring, path substring, then fuzzy matches to catch typos and
 * abbreviations. Fuzzy matches are skipped once the substring tiers fill the
 * list, so they only ever pad it.
 */
export function searchFiles(
  files: FileEntry[],
  query: string,
  fuse: Pick<Fuse<FileEntry>, 'search'> | null,
  limit = PICKER_LIMIT,
): PickerResults {
  const q = query.toLowerCase();
  const tiers: FileEntry[][] = [[], [], [], []];
  for (const e of files) {
    const t = tierOf(e, q);
    if (t >= 0) tiers[t].push(e);
  }
  const ranked = tiers.flatMap((t) => t.sort(byRelevance));

  let moreIsLowerBound = false;
  if (ranked.length < limit && fuse) {
    const seen = new Set(ranked.map((e) => e.path));
    const fuzzy = fuse.search(query, { limit: FUZZY_LIMIT });
    for (const r of fuzzy) {
      if (!seen.has(r.item.path)) ranked.push(r.item);
    }
    moreIsLowerBound = fuzzy.length >= FUZZY_LIMIT;
  }

  return {
    items: ranked.slice(0, limit).map((entry) => ({ entry })),
    more: Math.max(0, ranked.length - limit),
    moreIsLowerBound,
  };
}

/**
 * What the picker shows for a bare '@': the conversation's changed files
 * first (what you most likely want to point the agent at), then the project's
 * top level, folders first.
 */
export function initialItems(files: FileEntry[], changedPaths: string[], limit = PICKER_LIMIT): PickerResults {
  const byPath = new Map(files.map((e) => [e.path, e]));
  const changed: PickerItem[] = [];
  for (const p of new Set(changedPaths)) {
    const entry = byPath.get(p);
    if (entry) changed.push({ entry, group: 'Changed' });
  }
  const shown = new Set(changed.map((i) => i.entry.path));
  const topLevel = files
    .filter((e) => !shown.has(e.path) && !e.path.slice(0, e.isDir ? -1 : undefined).includes('/'))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path))
    .map((entry): PickerItem => ({ entry, group: 'Project' }));
  const all = [...changed, ...topLevel];
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit), moreIsLowerBound: false };
}

/** Next selection for a key, wrapping at the ends; null for other keys.
 *  PageUp/PageDown stop at the ends rather than wrap. */
export function moveSelection(key: string, index: number, count: number, page = 8): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown': return (index + 1) % count;
    case 'ArrowUp': return (index - 1 + count) % count;
    case 'PageDown': return Math.min(index + page, count - 1);
    case 'PageUp': return Math.max(index - page, 0);
    default: return null;
  }
}
