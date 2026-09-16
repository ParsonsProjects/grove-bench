/**
 * Attention triage: classify each session into one mutually exclusive state so
 * the sidebar can offer All / Needs you / Working / Unread filters with counts
 * that add up. Priority order matters — a session blocked on a permission is
 * "needs you" even if it also finished a turn while unfocused.
 */

export type TriageState = 'needs-you' | 'working' | 'unread' | 'idle';
export type TriageFilter = 'all' | 'needs-you' | 'working' | 'unread';

export const TRIAGE_FILTERS: TriageFilter[] = ['all', 'needs-you', 'working', 'unread'];

export const TRIAGE_FILTER_LABELS: Record<TriageFilter, string> = {
  all: 'All',
  'needs-you': 'Needs you',
  working: 'Working',
  unread: 'Unread',
};

export interface TriageSignals {
  /** Blocked on a permission prompt or an unanswered question. */
  needsInput: boolean;
  /** A turn is in progress. */
  running: boolean;
  /** Finished a turn (or got a PR alert) while not focused. */
  unread: boolean;
}

export function triageState(s: TriageSignals): TriageState {
  if (s.needsInput) return 'needs-you';
  if (s.running) return 'working';
  if (s.unread) return 'unread';
  return 'idle';
}

export function matchesTriageFilter(filter: TriageFilter, state: TriageState): boolean {
  return filter === 'all' || filter === state;
}

export interface TriageCounts {
  all: number;
  'needs-you': number;
  working: number;
  unread: number;
}

export function triageCounts(states: Iterable<TriageState>): TriageCounts {
  const counts: TriageCounts = { all: 0, 'needs-you': 0, working: 0, unread: 0 };
  for (const state of states) {
    counts.all++;
    if (state !== 'idle') counts[state]++;
  }
  return counts;
}
