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

/** The time a thread's age counts from, and what that time is. */
export interface RowAge {
  /** Timestamp (ms); 0 when unknown. */
  at: number;
  kind: 'read' | 'active' | 'created';
}

/**
 * What a thread's age counts from. An unread thread counts from when you
 * last had it open, so the unread rows say how long since you last looked;
 * any other thread from its last activity, or its creation.
 */
export function rowAge(session: SortableSession, unread = false, lastReadAt?: number): RowAge {
  if (unread && lastReadAt) return { at: lastReadAt, kind: 'read' };
  if (session.lastActiveAt != null) return { at: session.lastActiveAt, kind: 'active' };
  return { at: session.createdAt ?? 0, kind: 'created' };
}

/**
 * Pure, non-mutating sort of sessions.
 * - `name`: case-insensitive by label (`displayName || branch`).
 * - `age`:  by `ageOf`, which defaults to `lastActiveAt ?? createdAt`.
 * `asc` = A→Z / oldest-first; `desc` = Z→A / newest-first.
 */
export function sortSessions<T extends SortableSession>(
  sessions: T[],
  sort: SessionSortState,
  ageOf: (session: T) => number = (s) => rowAge(s).at,
): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    let cmp: number;
    if (sort.key === 'name') {
      const la = (a.displayName || a.branch || '').toLowerCase();
      const lb = (b.displayName || b.branch || '').toLowerCase();
      cmp = la.localeCompare(lb);
    } else {
      cmp = ageOf(a) - ageOf(b);
    }
    return cmp * sign;
  });
}
