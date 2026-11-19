/**
 * The board (alpha, the `boardView` setting): the open threads as cards in
 * columns by stage, optionally split into lanes per project or group.
 *
 * A thread's live state picks its column first and its pull request second:
 * one that is working, or waiting on you, sits in that column whatever its
 * PR says. A quiet one is in Review until its PR is merged or closed.
 */

import type { PrInfo } from '../../shared/types.js';
import type { FollowUp } from '../../shared/follow-ups.js';
import type { AgentSpriteState } from './agent-sprite.js';

export type BoardStage = 'working' | 'needs-you' | 'review' | 'done';

export const BOARD_STAGES: readonly BoardStage[] = ['working', 'needs-you', 'review', 'done'];

const BOARD_STAGE_LABELS: Record<BoardStage, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  review: 'Review',
  done: 'Done',
};

/** The line under a column's heading, saying what lands there. */
const BOARD_STAGE_HINTS: Record<BoardStage, string> = {
  working: 'The agent is working.',
  'needs-you': 'Waiting for you, or failed.',
  review: 'Finished, not merged yet.',
  done: 'PR merged or closed.',
};

/** The board's columns: work not started yet (follow-ups, shared/follow-ups.ts),
 *  then the threads' stages. */
export type BoardColumn = 'follow-ups' | BoardStage;

export const BOARD_COLUMNS: readonly BoardColumn[] = ['follow-ups', ...BOARD_STAGES];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  'follow-ups': 'Follow-ups',
  ...BOARD_STAGE_LABELS,
};

export const BOARD_COLUMN_HINTS: Record<BoardColumn, string> = {
  'follow-ups': 'Work for a later thread.',
  ...BOARD_STAGE_HINTS,
};

/** The follow-ups the board's first column shows: open ones in a project
 *  still in Grove Bench, unless a thread started from one is open (that
 *  thread's card stands for it). One whose thread was closed before the work
 *  was done comes back, `startedBefore`, oldest first as in the drawer. */
export function boardFollowUps(
  list: readonly FollowUp[],
  repos: readonly string[],
  isOpenThread: (sessionId: string) => boolean,
): { followUp: FollowUp; startedBefore: boolean }[] {
  const known = new Set(repos);
  return list.flatMap((f) => {
    if (f.doneAt !== undefined || !known.has(f.repoPath)) return [];
    const started = f.startedSessionIds ?? [];
    if (started.some(isOpenThread)) return [];
    return [{ followUp: f, startedBefore: started.length > 0 }];
  });
}

/** The column a thread's card is in, from its status (the colour its
 *  character or square wears) and its primary PR. Null for a thread being
 *  removed: it has no card. */
export function boardStage(state: AgentSpriteState, pr: Pick<PrInfo, 'state'> | null): BoardStage | null {
  switch (state) {
    case 'removing':
      return null;
    case 'working':
    case 'starting':
    case 'installing':
      return 'working';
    case 'permission':
    case 'asking':
    case 'error':
      return 'needs-you';
    default:
      return pr?.state === 'MERGED' || pr?.state === 'CLOSED' ? 'done' : 'review';
  }
}

export type BoardLanes = 'none' | 'project' | 'group';

export const BOARD_LANES: readonly BoardLanes[] = ['none', 'project', 'group'];

export const BOARD_LANE_LABELS: Record<BoardLanes, string> = {
  none: 'None',
  project: 'Project',
  group: 'Group',
};

export interface BoardLane<T> {
  /** Stable key: 'all', a project's path, a group's id, or 'no-group'. */
  key: string;
  /** The lane's heading. Null for the single lane with lanes off. */
  label: string | null;
  /** The projects whose colour squares the heading shows: the project
   *  itself, or a group's members' projects. */
  repoPaths: string[];
  cards: T[];
}

export interface LaneSource {
  /** Projects in the sidebar's order. */
  repos: readonly string[];
  repoName(path: string): string;
  /** Thread groups in the sidebar's order. */
  groups: readonly { id: string; name: string; sessionIds: readonly string[] }[];
}

/** The lanes to draw for these cards, keeping the cards' order inside each.
 *  A lane with no card is left out, so the board doesn't fill with empty
 *  rows. "Not in a group" comes last. */
export function boardLanes<T extends { id: string; repoPath: string }>(cards: readonly T[], lanes: BoardLanes, src: LaneSource): BoardLane<T>[] {
  if (lanes === 'none') return [{ key: 'all', label: null, repoPaths: [], cards: [...cards] }];

  if (lanes === 'project') {
    // Projects the sidebar doesn't list (shouldn't happen) go after the rest.
    const order = [...src.repos, ...cards.map((c) => c.repoPath).filter((p) => !src.repos.includes(p))];
    return [...new Set(order)].flatMap((path) => {
      const inLane = cards.filter((c) => c.repoPath === path);
      return inLane.length > 0 ? [{ key: path, label: src.repoName(path), repoPaths: [path], cards: inLane }] : [];
    });
  }

  const placed = new Set<string>();
  const out: BoardLane<T>[] = [];
  for (const group of src.groups) {
    const members = new Set(group.sessionIds);
    const inLane = cards.filter((c) => members.has(c.id));
    if (inLane.length === 0) continue;
    for (const c of inLane) placed.add(c.id);
    out.push({ key: group.id, label: group.name, repoPaths: [...new Set(inLane.map((c) => c.repoPath))], cards: inLane });
  }
  const rest = cards.filter((c) => !placed.has(c.id));
  if (rest.length > 0) out.push({ key: 'no-group', label: 'Not in a group', repoPaths: [], cards: rest });
  return out;
}

export type PrBadgeTone = 'neutral' | 'muted' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

/** A card's pull request in one word or two, most telling first: how it
 *  ended, then what stops it (a draft, changes asked for, failing checks),
 *  then how it stands. Purple is merged, as elsewhere in the app. */
export function prSummary(pr: Pick<PrInfo, 'state' | 'isDraft' | 'reviewDecision' | 'checks'>): { label: string; tone: PrBadgeTone } {
  if (pr.state === 'MERGED') return { label: 'Merged', tone: 'accent' };
  if (pr.state === 'CLOSED') return { label: 'Closed', tone: 'muted' };
  if (pr.isDraft) return { label: 'Draft', tone: 'muted' };
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { label: 'Changes requested', tone: 'warning' };
  if (pr.checks && pr.checks.failed > 0) return { label: 'Checks failing', tone: 'danger' };
  if (pr.reviewDecision === 'APPROVED') return { label: 'Approved', tone: 'success' };
  if (pr.checks && pr.checks.pending > 0) return { label: 'Checks running', tone: 'info' };
  if (pr.checks && pr.checks.total > 0) return { label: 'Checks passing', tone: 'success' };
  return { label: 'Open', tone: 'neutral' };
}

/** Whether a card matches the board's filter: every word of the query
 *  appears in one of its fields, ignoring case. An empty query matches all. */
export function matchesBoardQuery(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
