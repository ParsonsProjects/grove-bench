/**
 * Follow-ups in main (shared/follow-ups.ts): saved in follow-ups.json under
 * userData, one list for every project. Agents change it through their
 * follow-up tools (grove-followups, wired up in agent-session.ts), the window
 * through IPC; either way every window is told (onFollowUpsChanged), so the
 * drawer shows a follow-up the moment an agent adds it.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import { FOLLOW_UP_LIMITS, type FollowUp } from '../shared/follow-ups.js';
import type { FollowUpOperations } from './adapters/types.js';
import { readJsonFile, writeFileAtomicSync } from './json-file.js';
import { logger } from './logger.js';

let cached: FollowUp[] | null = null;
const listeners = new Set<(list: FollowUp[]) => void>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'follow-ups.json');
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** The entries of the file that are follow-ups; anything else is dropped. */
function validEntries(value: unknown): FollowUp[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is FollowUp => !!f && typeof f === 'object'
    && isString((f as FollowUp).id) && isString((f as FollowUp).repoPath)
    && isString((f as FollowUp).title) && isString((f as FollowUp).details)
    && typeof (f as FollowUp).createdAt === 'number');
}

/** The saved list (empty when missing or damaged), or null when the file
 *  exists but can't be read right now. */
function readFile(): FollowUp[] | null {
  const read = readJsonFile(filePath());
  if (read.kind === 'unreadable') return null;
  return read.kind === 'ok' ? validEntries(read.value) : [];
}

/** Every project's follow-ups, oldest first, or null while the file can't be
 *  read (a passing lock), so "none" is never mistaken for the real list. */
export function listFollowUps(): FollowUp[] | null {
  if (cached) return cached;
  const list = readFile();
  if (list) cached = list;
  return list;
}

/** The list to change. Throws when the file can't be read, rather than save
 *  a list that is missing everything in it. */
function forUpdate(): FollowUp[] {
  const list = listFollowUps();
  if (!list) throw new Error("Grove Bench couldn't read its saved follow-ups, so nothing was changed. Try again in a moment.");
  return list;
}

/** Keep `next`: drop the oldest done ones past the cap in each project,
 *  save, and tell the windows. */
function save(next: FollowUp[]): void {
  const doneByRepo = new Map<string, FollowUp[]>();
  for (const f of next) {
    if (f.doneAt === undefined) continue;
    const list = doneByRepo.get(f.repoPath) ?? [];
    list.push(f);
    doneByRepo.set(f.repoPath, list);
  }
  const dropped = new Set<string>();
  for (const done of doneByRepo.values()) {
    done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    for (const f of done.slice(FOLLOW_UP_LIMITS.donePerProject)) dropped.add(f.id);
  }
  cached = dropped.size > 0 ? next.filter((f) => !dropped.has(f.id)) : next;
  try {
    writeFileAtomicSync(filePath(), JSON.stringify(cached, null, 2));
  } catch (err) {
    logger.warn('[follow-ups] could not save follow-ups:', err);
  }
  for (const listener of listeners) {
    try {
      listener(cached);
    } catch (err) {
      logger.warn('[follow-ups] a change listener failed:', err);
    }
  }
}

/** Call `listener` with the whole list after every change. Returns a way to stop. */
export function onFollowUpsChanged(listener: (list: FollowUp[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function newId(taken: readonly FollowUp[]): string {
  const ids = new Set(taken.map((f) => f.id));
  for (;;) {
    const id = randomBytes(3).toString('hex');
    if (!ids.has(id)) return id;
  }
}

/** One line, cut to `max` characters. */
function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface FollowUpInput {
  repoPath: string;
  title: string;
  details: string;
  fromSessionId?: string;
  fromLabel?: string;
  fromBranch?: string;
}

/** Add a follow-up to its project. One with the same title that is still
 *  open is returned instead (`existing`), so an agent that asks twice
 *  doesn't list the work twice. */
export function addFollowUp(input: FollowUpInput, now = Date.now()): { followUp: FollowUp; existing: boolean } {
  const title = oneLine(input.title, FOLLOW_UP_LIMITS.title);
  if (!title) throw new Error('A follow-up needs a title.');
  const list = forUpdate();
  const open = list.filter((f) => f.repoPath === input.repoPath && f.doneAt === undefined);
  const same = open.find((f) => f.title.toLowerCase() === title.toLowerCase());
  if (same) return { followUp: same, existing: true };
  if (open.length >= FOLLOW_UP_LIMITS.openPerProject) {
    throw new Error(`This project already has ${open.length} open follow-ups, the most it can have. `
      + 'Ask the user to clear some in the Follow-ups drawer, or mark finished ones done.');
  }
  const followUp: FollowUp = {
    id: newId(list),
    repoPath: input.repoPath,
    title,
    details: input.details.trim().slice(0, FOLLOW_UP_LIMITS.details),
    createdAt: now,
    ...(input.fromSessionId ? { fromSessionId: input.fromSessionId } : {}),
    ...(input.fromLabel?.trim() ? { fromLabel: oneLine(input.fromLabel, 200) } : {}),
    ...(input.fromBranch?.trim() ? { fromBranch: input.fromBranch.trim() } : {}),
  };
  save([...list, followUp]);
  return { followUp, existing: false };
}

/** The follow-up with `id`, from `repoPath` when given: an agent can only
 *  change its own project's. Throws a message the agent or the user reads. */
function find(list: readonly FollowUp[], id: string, repoPath?: string): FollowUp {
  const key = id.trim().toLowerCase();
  const found = list.find((f) => f.id === key && (repoPath === undefined || f.repoPath === repoPath));
  if (!found) throw new Error(`There is no follow-up ${id.trim()}${repoPath === undefined ? '' : ' in this project'}.`);
  return found;
}

function replace(list: readonly FollowUp[], next: FollowUp): FollowUp[] {
  return list.map((f) => (f.id === next.id ? next : f));
}

/** Mark it done, by a thread's agent (`sessionId`, with what it said it
 *  did) or by you. Done already: left as it was. */
export function markFollowUpDone(
  id: string,
  by: { repoPath?: string; sessionId?: string; note?: string } = {},
  now = Date.now(),
): FollowUp {
  const list = forUpdate();
  const found = find(list, id, by.repoPath);
  if (found.doneAt !== undefined) return found;
  const note = by.note ? by.note.trim().slice(0, FOLLOW_UP_LIMITS.note) : '';
  const next: FollowUp = {
    ...found,
    doneAt: now,
    ...(by.sessionId ? { doneBySessionId: by.sessionId } : {}),
    ...(note ? { doneNote: note } : {}),
  };
  save(replace(list, next));
  return next;
}

/** Open it again (you marked it done by mistake, or the work wasn't finished). */
export function reopenFollowUp(id: string): FollowUp {
  const list = forUpdate();
  const { doneAt: _doneAt, doneBySessionId: _by, doneNote: _note, ...open } = find(list, id);
  save(replace(list, open));
  return open;
}

/** Note the thread you started from it, so the drawer can show it. */
export function markFollowUpStarted(id: string, sessionId: string): void {
  const list = forUpdate();
  const found = find(list, id);
  if (found.startedSessionIds?.includes(sessionId)) return;
  save(replace(list, { ...found, startedSessionIds: [...(found.startedSessionIds ?? []), sessionId] }));
}

export function removeFollowUp(id: string): void {
  const list = forUpdate();
  const key = id.trim().toLowerCase();
  if (!list.some((f) => f.id === key)) return;
  save(list.filter((f) => f.id !== key));
}

/** A thread's view of follow-ups, as its agent's tools use them
 *  (FollowUpOperations): read from `thread` at each call, so a follow-up is
 *  recorded under the thread's name and branch at the time. */
export function followUpOperationsFor(thread: Readonly<{ id: string; repoPath: string; branch: string; displayName?: string | null }>): FollowUpOperations {
  return {
    add: ({ title, details }) => addFollowUp({
      repoPath: thread.repoPath,
      title,
      details,
      fromSessionId: thread.id,
      fromLabel: thread.displayName || thread.branch || undefined,
      fromBranch: thread.branch || undefined,
    }),
    list: ({ includeDone }) => {
      const mine = forUpdate().filter((f) => f.repoPath === thread.repoPath);
      const open = mine.filter((f) => f.doneAt === undefined);
      if (!includeDone) return open;
      const done = mine.filter((f) => f.doneAt !== undefined).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
      return [...open, ...done];
    },
    done: (id, note) => markFollowUpDone(id, { repoPath: thread.repoPath, sessionId: thread.id, note }),
  };
}

/** A project's open follow-ups listed most this many at a time in the system prompt. */
const PROMPT_LIST_MAX = 10;

/** What a new thread is told about follow-ups: what they are, when to add
 *  one, and the project's open ones (newest first, titles only). */
export function followUpsForSystemPrompt(repoPath: string): string {
  const open = (listFollowUps() ?? [])
    .filter((f) => f.repoPath === repoPath && f.doneAt === undefined)
    .sort((a, b) => b.createdAt - a.createdAt);
  let prompt = 'FOLLOW-UPS: Grove Bench keeps a list of follow-ups for this project: work for a later thread. '
    + 'Use the grove-followups tools (followup_add, followup_list, followup_done). '
    + 'When you find work outside what the user asked for in this thread that shouldn\'t be lost (a bug you noticed, a refactor or test you left out, something the user said to do later), '
    + 'add it with followup_add instead of doing it now or only mentioning it, and tell the user you added it. '
    + 'Write the details so a new thread with none of this thread\'s context can start on it: what, where (files), why, and what done looks like. '
    + 'Don\'t add one for work you are about to do in this thread. '
    + 'If this thread\'s first message names a follow-up, or your work finishes one listed below, mark it with followup_done when it is done. '
    + 'Don\'t start on a follow-up unless the user asks.';
  if (open.length > 0) {
    const shown = open.slice(0, PROMPT_LIST_MAX);
    prompt += '\n\nOpen follow-ups when this thread started (followup_list shows the current ones and their details):\n'
      + shown.map((f) => `- ${f.id}: ${f.title}`).join('\n');
    if (open.length > shown.length) prompt += `\n(${open.length - shown.length} more not listed.)`;
  }
  return prompt;
}

/** Test hook: forget the cached list and the listeners, as at app start. */
export function resetFollowUpsForTest(): void {
  cached = null;
  listeners.clear();
}
