import type { SessionSortState } from '../../shared/types.js';

export type { SessionSortState };

/** Initial ordering before the user picks one: alphabetical by name (A→Z). */
export const DEFAULT_SORT: SessionSortState = { key: 'name', dir: 'asc' };

/** The natural direction when first switching to a sort key. */
export function defaultDirFor(key: SessionSortState['key']): SessionSortState['dir'] {
  return key === 'name' ? 'asc' : 'desc';
}

interface SortableSession {
  displayName?: string | null;
  branch: string;
  lastActiveAt?: number | null;
  createdAt?: number | null;
}

/**
 * Pure, non-mutating sort of sessions.
 * - `name`: case-insensitive by label (`displayName || branch`).
 * - `age`:  by `lastActiveAt ?? createdAt`.
 * `asc` = A→Z / oldest-first; `desc` = Z→A / newest-first.
 */
export function sortSessions<T extends SortableSession>(sessions: T[], sort: SessionSortState): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    let cmp: number;
    if (sort.key === 'name') {
      const la = (a.displayName || a.branch || '').toLowerCase();
      const lb = (b.displayName || b.branch || '').toLowerCase();
      cmp = la.localeCompare(lb);
    } else {
      cmp = (a.lastActiveAt ?? a.createdAt ?? 0) - (b.lastActiveAt ?? b.createdAt ?? 0);
    }
    return cmp * sign;
  });
}
