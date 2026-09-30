/**
 * Attention triage: classify each session into one mutually exclusive state so
 * the sidebar can offer All / Needs you / Working / Unread filters with counts
 * that add up. Priority order matters — a session blocked on a permission is
 * "needs you" even if it also finished a turn while unfocused. The order is the
 * status colour's (agentSpriteState), so the two never disagree.
 */

import type { AgentSpriteState } from './agent-sprite.js';

export type TriageState = 'needs-you' | 'working' | 'unread' | 'idle';
export type TriageFilter = 'all' | 'needs-you' | 'working' | 'unread';

export const TRIAGE_FILTERS: TriageFilter[] = ['all', 'needs-you', 'working', 'unread'];

export const TRIAGE_FILTER_LABELS: Record<TriageFilter, string> = {
  all: 'All',
  'needs-you': 'Needs you',
  working: 'Working',
  unread: 'Unread',
};

/**
 * The triage state a conversation's status colour stands for (see
 * AGENT_SPRITES), so a row's dot or character always matches the chip it is
 * counted under. Error, and every quiet state, belong to no chip.
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
    default:
      return 'idle';
  }
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
