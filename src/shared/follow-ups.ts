/**
 * Follow-ups: work an agent (or you) found that belongs in a later thread of
 * the same project, such as a bug it noticed on the way or a test it left
 * out. Agents add them with Grove's follow-up tools (grove-followups); you
 * start a thread from one in the Follow-ups drawer, and the agent in that
 * thread marks it done, or closes it if it isn't needed after all. Main
 * keeps them in follow-ups.json (main/follow-ups.ts), one list for every
 * project, so every thread sees a new one at once whatever branch it is on.
 * An agent can read, add, finish and close any project's, not only its own.
 */

/** How soon a follow-up should be picked up. The agent that adds one sets it
 *  (followup_add); you can change it. */
export type FollowUpPriority = 'high' | 'normal' | 'low';

/** Highest first: the order lists show them in. */
export const FOLLOW_UP_PRIORITIES: readonly FollowUpPriority[] = ['high', 'normal', 'low'];

export const FOLLOW_UP_PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export function isFollowUpPriority(value: unknown): value is FollowUpPriority {
  return typeof value === 'string' && (FOLLOW_UP_PRIORITIES as readonly string[]).includes(value);
}

/** A priority an agent typed, in any case and with spaces around it, or
 *  undefined when it isn't one (the follow-up is then normal). */
export function toFollowUpPriority(value: unknown): FollowUpPriority | undefined {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return isFollowUpPriority(word) ? word : undefined;
}

/** Its priority: normal for one saved before follow-ups had one. */
export function followUpPriority(f: Pick<FollowUp, 'priority'>): FollowUpPriority {
  return f.priority ?? 'normal';
}

/** Where a priority comes in a list: 0 for high, the most pressing. */
export function followUpPriorityRank(priority: FollowUpPriority): number {
  return FOLLOW_UP_PRIORITIES.indexOf(priority);
}

/** `list` highest priority first, keeping the order it had inside each
 *  priority (oldest first, as the list is saved). Doesn't change `list`. */
export function byFollowUpPriority<T extends Pick<FollowUp, 'priority'>>(list: readonly T[]): T[] {
  const rank = (f: T) => followUpPriorityRank(followUpPriority(f));
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export interface FollowUp {
  /** Short, so an agent can type it back (followup_done). */
  id: string;
  repoPath: string;
  /** One line: what to do. */
  title: string;
  /** Unset in follow-ups saved before there were priorities: normal. */
  priority?: FollowUpPriority;
  /** What a new thread needs to start without this one's context: where,
   *  why, and what done looks like. Sent with the title as its first message. */
  details: string;
  createdAt: number;
  /** The thread that added it, and its name then (it may be deleted later).
   *  Unset for one added another way. */
  fromSessionId?: string;
  fromLabel?: string;
  /** The branch that thread was on, so the next one can look at that work. */
  fromBranch?: string;
  /** The threads started from it, oldest first. */
  startedSessionIds?: string[];
  /** The project of the thread that added it, when that isn't `repoPath`:
   *  an agent can add one to another project (followup_add's project). */
  fromRepoPath?: string;
  /** Set once it is done: by an agent (followup_done) or by you. Never set
   *  with `closedAt`. */
  doneAt?: number;
  /** The thread whose agent marked it done, if one did. */
  doneBySessionId?: string;
  /** What the agent said it did. */
  doneNote?: string;
  /** Set once it is closed without being done: it isn't needed any more, or
   *  won't be done. By an agent (followup_close) or by you. */
  closedAt?: number;
  /** The thread whose agent closed it, if one did. */
  closedBySessionId?: string;
  /** Why, as the agent that closed it said. */
  closeReason?: string;
}

/** Still to do: neither done nor closed. */
export function isFollowUpOpen(f: Pick<FollowUp, 'doneAt' | 'closedAt'>): boolean {
  return f.doneAt === undefined && f.closedAt === undefined;
}

/** When it was done or closed, or undefined while it is open. */
export function followUpEndedAt(f: Pick<FollowUp, 'doneAt' | 'closedAt'>): number | undefined {
  return f.doneAt ?? f.closedAt;
}

/** The word an agent gives followup_list for every project's follow-ups. */
export const ALL_PROJECTS = 'all';

/** A project's name, as the sidebar shows it: its folder's name. */
export function projectName(repoPath: string): string {
  return repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath;
}

/** What changed in one save, as main tells the windows: the follow-ups
 *  added or changed, and the ids of ones removed (deleted, or old done
 *  ones dropped). Small, where the whole list could be large. */
export interface FollowUpsChange {
  upserted: FollowUp[];
  removed: string[];
}

/** `list` with `change` applied: changed ones replaced where they are, new
 *  ones added at the end (the list is oldest first), removed ones dropped.
 *  Applying a change twice gives the same list. */
export function applyFollowUpsChange(list: readonly FollowUp[], change: FollowUpsChange): FollowUp[] {
  const removed = new Set(change.removed);
  const changed = new Map(change.upserted.map((f) => [f.id, f]));
  const next = list.filter((f) => !removed.has(f.id)).map((f) => changed.get(f.id) ?? f);
  const present = new Set(next.map((f) => f.id));
  for (const f of change.upserted) if (!present.has(f.id) && !removed.has(f.id)) next.push(f);
  return next;
}

export const FOLLOW_UP_LIMITS = {
  /** Longest title kept. */
  title: 120,
  /** Longest details kept. */
  details: 4000,
  /** Details followup_list shows of each when it lists several. */
  detailsInList: 200,
  /** Longest note kept when one is marked done, or reason when one is closed. */
  note: 500,
  /** Open follow-ups one project can have: an agent that adds one per
   *  file it touched is told to stop. */
  openPerProject: 100,
  /** Done and closed follow-ups kept per project, together, newest first. */
  endedPerProject: 50,
} as const;

/** Where the thread that added it was, in brackets: its branch, and its
 *  project when that is another one. Empty when neither is known. */
export function followUpOriginDetail(f: Pick<FollowUp, 'fromBranch' | 'fromRepoPath'>): string {
  const project = f.fromRepoPath ? `project ${projectName(f.fromRepoPath)}` : '';
  if (f.fromBranch) return ` (branch ${f.fromBranch}${project ? ` in ${project}` : ''})`;
  return project ? ` (in ${project})` : '';
}

/** The first message of a thread started from a follow-up: the title, the
 *  details, and a line telling the agent which follow-up it is, so it can
 *  mark it done, or close it if it turns out not to be needed. You can edit
 *  it before sending. */
export function followUpPrompt(f: Pick<FollowUp, 'id' | 'title' | 'details' | 'fromLabel' | 'fromBranch' | 'fromRepoPath'>): string {
  const from = f.fromLabel ? ` It was added in the thread "${f.fromLabel}"${followUpOriginDetail(f)}.` : '';
  const parts = [f.title.trim(), f.details.trim()].filter(Boolean);
  parts.push(`(This is follow-up ${f.id}.${from} When it's done, mark it done with followup_done. `
    + "If it turns out it isn't needed, close it with followup_close and say why.)");
  return parts.join('\n\n');
}
