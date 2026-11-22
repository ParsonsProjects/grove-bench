/**
 * Follow-ups: work an agent (or you) found that belongs in a later thread of
 * the same project, such as a bug it noticed on the way or a test it left
 * out. Agents add them with Grove's follow-up tools (grove-followups); you
 * start a thread from one in the Follow-ups drawer, and the agent in that
 * thread marks it done. Main keeps them in follow-ups.json
 * (main/follow-ups.ts), one list for every project, so every thread sees a
 * new one at once whatever branch it is on.
 */

export interface FollowUp {
  /** Short, so an agent can type it back (followup_done). */
  id: string;
  repoPath: string;
  /** One line: what to do. */
  title: string;
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
  /** Set once it is done: by an agent (followup_done) or by you. */
  doneAt?: number;
  /** The thread whose agent marked it done, if one did. */
  doneBySessionId?: string;
  /** What the agent said it did. */
  doneNote?: string;
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
  /** Longest note kept when one is marked done. */
  note: 500,
  /** Open follow-ups one project can have: an agent that adds one per
   *  file it touched is told to stop. */
  openPerProject: 100,
  /** Done follow-ups kept per project, newest first. */
  donePerProject: 50,
} as const;

/** The first message of a thread started from a follow-up: the title, the
 *  details, and a line telling the agent which follow-up it is, so it can
 *  mark it done. You can edit it before sending. */
export function followUpPrompt(f: Pick<FollowUp, 'id' | 'title' | 'details' | 'fromLabel' | 'fromBranch'>): string {
  const from = f.fromLabel
    ? ` It was added in the thread "${f.fromLabel}"${f.fromBranch ? ` (branch ${f.fromBranch})` : ''}.`
    : '';
  const parts = [f.title.trim(), f.details.trim()].filter(Boolean);
  parts.push(`(This is follow-up ${f.id}.${from} When it's done, mark it done with followup_done.)`);
  return parts.join('\n\n');
}
