/**
 * Attention triage: classify each session into one mutually exclusive state so
 * the sidebar can offer All / Needs you / Working / Unread / Idle filters with
 * counts that add up. Priority order matters: a session blocked on a
 * permission is "needs you" even if it also finished a turn while unfocused.
 * The order is the status colour's (agentSpriteState), so the two never
 * disagree.
 *
 * To do is the one filter that isn't a state: it is a flag the user sets,
 * and a thread in any state can carry it, so its count overlaps the others.
 */

import type { AgentSpriteState } from './agent-sprite.js';

/** 'none' belongs to no chip: closed, errored or being removed. */
export type TriageState = 'needs-you' | 'working' | 'unread' | 'idle' | 'none';
export type TriageFilter = 'all' | 'needs-you' | 'working' | 'unread' | 'idle' | 'todo';

export const TRIAGE_FILTERS: TriageFilter[] = ['all', 'needs-you', 'working', 'unread', 'idle', 'todo'];

export const TRIAGE_FILTER_LABELS: Record<TriageFilter, string> = {
  all: 'All',
  'needs-you': 'Needs you',
  working: 'Working',
  unread: 'Unread',
  idle: 'Idle',
  todo: 'To do',
};

/** A thread as the filters see it: its state, and whether it is flagged To do. */
export interface TriageEntry {
  state: TriageState;
  todo: boolean;
}

/**
 * The triage state a conversation's status colour stands for (see
 * AGENT_SPRITES), so a row's dot or character always matches the chip it is
 * counted under. Idle is an open thread with nothing going on: ready, or
 * asleep until it is opened. Error, closed and removing belong to no chip.
 */
export function triageForSprite(state: AgentSpriteState): TriageState {
  switch (state) {
    case 'permission':
      return 'needs-you';
    case 'working':
    case 'starting':
    case 'installing':
      return 'working';
    case 'unread':
      return 'unread';
    case 'ready':
    case 'sleeping':
      return 'idle';
    default:
      return 'none';
  }
}

export function matchesTriageFilter(filter: TriageFilter, entry: TriageEntry): boolean {
  if (filter === 'todo') return entry.todo;
  return filter === 'all' || filter === entry.state;
}

export interface TriageCounts {
  all: number;
  'needs-you': number;
  working: number;
  unread: number;
  idle: number;
  todo: number;
}

export function triageCounts(entries: Iterable<TriageEntry>): TriageCounts {
  const counts: TriageCounts = { all: 0, 'needs-you': 0, working: 0, unread: 0, idle: 0, todo: 0 };
  for (const { state, todo } of entries) {
    counts.all++;
    if (state !== 'none') counts[state]++;
    if (todo) counts.todo++;
  }
  return counts;
}
