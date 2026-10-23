/**
 * Skill schedules in main: saving them, and the scheduler that says when one
 * is due. The thread itself is started by the renderer
 * (stores/schedules.svelte.ts), which starts every thread, so a scheduled
 * run shows and behaves like one started by hand. The scheduler only runs
 * while Grove is open; only the latest time since the last check counts, and
 * one found more than MISSED_AFTER_MS late is skipped, not caught up.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import { MAX_SCHEDULE_SESSIONS, MISSED_AFTER_MS, scheduleDueAt, type ScheduleOutcome, type SkillSchedule } from '../shared/skill-schedules.js';
import { loadSkillSchedules, saveSkillSchedules, updateSkillSchedules } from './app-state.js';
import { outcomeInputSchema, scheduleInputSchema } from './skill-schedule-schema.js';
import { logger } from './logger.js';

/** How often the scheduler looks for due schedules. Times are to the minute. */
const TICK_MS = 60_000;
/** How long a due run waits for the window to say what it did (a new
 *  worktree can take a while on Windows) before it is noted as not started. */
const ANSWER_WAIT_MS = 5 * 60_000;

/** Due runs sent to the window and not answered yet (recordScheduleRun),
 *  with when they were sent. */
const awaiting = new Map<string, number>();

function readAll(): SkillSchedule[] {
  const schedules = loadSkillSchedules();
  if (!schedules) throw new Error("Schedules can't be read right now. Try again in a moment.");
  return schedules;
}

/** The schedules, or null while app-state.json can't be read (a passing
 *  lock), so "none" is never mistaken for the real list. */
export function listSchedules(): SkillSchedule[] | null {
  return loadSkillSchedules();
}

/** Save a new or edited schedule from the renderer. A new, changed or
 *  resumed timing counts from `now`, so no time before it runs. */
export function saveSchedule(raw: unknown, now = Date.now()): SkillSchedule {
  const parsed = scheduleInputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "That schedule can't be saved");
  const input = parsed.data;
  const schedules = readAll();
  const old = input.id ? schedules.find((s) => s.id === input.id) : undefined;
  if (input.id && !old) throw new Error('That schedule was deleted');
  const keep = old && old.paused === input.paused && JSON.stringify(old.timing) === JSON.stringify(input.timing);
  const schedule: SkillSchedule = {
    ...input,
    id: old?.id ?? randomUUID(),
    scheduledFrom: keep ? old.scheduledFrom : now,
    checkedThrough: keep ? old.checkedThrough : now,
    sessionIds: old?.sessionIds ?? [],
    ...(old?.lastOutcome ? { lastOutcome: old.lastOutcome } : {}),
  };
  saveSkillSchedules(old ? schedules.map((s) => (s.id === schedule.id ? schedule : s)) : [...schedules, schedule], true);
  return schedule;
}

export function deleteSchedule(id: string): void {
  const schedules = readAll();
  saveSkillSchedules(schedules.filter((s) => s.id !== id), true);
}

/** Note a run's outcome, and the thread it started (which the open-thread
 *  cap counts). Applied once app-state.json can be read, if it can't now. */
function applyOutcome(id: string, outcome: Omit<ScheduleOutcome, 'at'>, now: number): void {
  updateSkillSchedules((schedules) => schedules.map((s) => (s.id !== id ? s : {
    ...s,
    lastOutcome: { at: now, ...outcome },
    sessionIds: outcome.sessionId ? [...s.sessionIds, outcome.sessionId].slice(-MAX_SCHEDULE_SESSIONS) : s.sessionIds,
  })));
}

/** Note what a scheduled run did. The schedule as saved, or null when it was
 *  deleted while its thread started, or the file can't be read just now (the
 *  record is saved once it can). */
export function recordScheduleRun(id: string, raw: unknown, now = Date.now()): SkillSchedule | null {
  const parsed = outcomeInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  awaiting.delete(id);
  applyOutcome(id, parsed.data, now);
  const schedules = loadSkillSchedules();
  if (!schedules) logger.warn(`[schedules] app-state.json can't be read; ${id}'s run is saved once it can`);
  return schedules?.find((s) => s.id === id) ?? null;
}

/**
 * The schedules due at `now`: the ids to run, and the list with every due
 * schedule marked checked up to now. Only the latest time since the last
 * check counts: it runs if it is at most MISSED_AFTER_MS late, and is skipped
 * and noted otherwise. Earlier times missed meanwhile are dropped. Exported
 * for tests.
 */
export function takeDue(schedules: SkillSchedule[], now: number): { schedules: SkillSchedule[]; run: string[]; changed: boolean } {
  const run: string[] = [];
  let changed = false;
  const next = schedules.map((schedule) => {
    const due = scheduleDueAt(schedule, now);
    if (due === null) return schedule;
    changed = true;
    if (now - due <= MISSED_AFTER_MS) {
      run.push(schedule.id);
      return { ...schedule, checkedThrough: now };
    }
    return {
      ...schedule,
      checkedThrough: now,
      lastOutcome: { at: now, skipped: 'it was due while Grove was closed or the computer was asleep' },
    };
  });
  return { schedules: next, run, changed };
}

/** Note the runs the window never answered (it was reloading, say), so the
 *  schedule doesn't go on showing its previous run. Whether any were. */
function expireUnanswered(now: number): boolean {
  let any = false;
  for (const [id, sentAt] of awaiting) {
    if (now - sentAt < ANSWER_WAIT_MS) continue;
    awaiting.delete(id);
    logger.warn(`[schedules] no answer from the window about ${id}'s run`);
    applyOutcome(id, { error: "The window didn't say it started a thread (it may have been reloading)" }, now);
    any = true;
  }
  return any;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Set once the app starts shutting down, so a restore that finishes late
 *  can't start the scheduler again. */
let stopped = false;

/** Look for due schedules now and every minute after, and ask the window to
 *  start their threads. Nothing is taken while there is no window, so a run
 *  isn't marked done with nobody to start it. */
export function startSkillScheduler(getWindow: () => BrowserWindow | null): void {
  if (timer || stopped) return;
  const tick = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const expired = expireUnanswered(now);
    const schedules = loadSkillSchedules();
    if (!schedules) return; // the file is locked for a moment: next tick
    const due = takeDue(schedules, now);
    if (due.changed) saveSkillSchedules(due.schedules, false);
    if (due.changed || expired) win.webContents.send(IPC.SKILL_SCHEDULES_CHANGED, due.schedules);
    for (const id of due.run) {
      logger.info(`[schedules] ${id} is due`);
      awaiting.set(id, now);
      win.webContents.send(IPC.SKILL_SCHEDULE_DUE, id);
    }
  };
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Stop for good: the app is shutting down or restarting to update. */
export function stopSkillScheduler(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

export function resetSkillSchedulerForTests(): void {
  stopSkillScheduler();
  stopped = false;
  awaiting.clear();
}
