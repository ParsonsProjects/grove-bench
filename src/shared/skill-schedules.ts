import type { PermissionMode } from './types.js';
import { skillLine } from './skill-line.js';

/**
 * Scheduled skills: an agent's skill run in a new thread of a project on a
 * schedule (every N hours, or daily at a time). The skill says how to do a
 * job; its schedule says when, and how the thread starts. Main keeps them
 * (main/skill-schedules.ts) and says when one is due; the renderer starts
 * the thread, as it does every other (stores/schedules.svelte.ts). Running a
 * skill once, by hand, needs no schedule.
 */

/** When a schedule runs. Times are the computer's local time. */
export type ScheduleTiming =
  /** Every `hours` hours, counted from when the schedule was set. */
  | { kind: 'every'; hours: number }
  /** Each day at `time` (HH:MM, 24-hour), or Monday to Friday only. */
  | { kind: 'daily'; time: string; weekdaysOnly: boolean };

/** What a scheduled run did. */
export interface ScheduleOutcome {
  at: number;
  /** The thread it started. */
  sessionId?: string;
  /** Why it didn't start one (the cap, or a time missed while Grove was closed). */
  skipped?: string;
  /** Why the thread couldn't start. */
  error?: string;
}

/** A skill run in a new thread: by hand once, or each time a schedule comes due. */
export interface SkillRun {
  repoPath: string;
  /** The agent whose skill it is. Never swapped for another: the skill and
   *  the tools it needs may only be set up for this one. */
  agentId: string;
  /** The skill's name, as the agent lists it. */
  skill: string;
  /** Sent after the skill's name: what this run should work on, say. */
  note: string;
  /** A new branch in its own worktree, or the project folder itself. */
  start: 'new' | 'folder';
  /** Mode to start in; '' for the agent's saved default. */
  permissionMode: PermissionMode | '';
}

/** What the user sets for a schedule. */
export interface SkillScheduleFields extends SkillRun {
  timing: ScheduleTiming;
  /** No run starts while this many threads the schedule started are still
   *  open (not closed or deleted). */
  maxOpen: number;
  paused: boolean;
}

export interface SkillSchedule extends SkillScheduleFields {
  id: string;
  /** When the timing was last set or resumed. An `every` timing counts from
   *  here, and no time before it runs. */
  scheduledFrom: number;
  /** Scheduled times up to here have been run or skipped. */
  checkedThrough: number;
  lastOutcome?: ScheduleOutcome;
  /** Threads its runs started, oldest first (the last MAX_SCHEDULE_SESSIONS). */
  sessionIds: string[];
}

/** New schedules have no id yet. */
export type SkillScheduleInput = SkillScheduleFields & { id?: string };

export const MAX_SCHEDULE_SESSIONS = 20;
export const MAX_OPEN_LIMIT = 10;
export const MAX_NOTE_LENGTH = 2_000;
/** A scheduled time found this late (Grove was closed, the computer was
 *  asleep) is skipped rather than run. */
export const MISSED_AFTER_MS = 15 * 60_000;

const HOUR_MS = 3_600_000;

/** Hours and minutes of an HH:MM time, or null when it isn't one. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/**
 * The first scheduled time strictly after `after`, or null for a timing it
 * can't read. `anchor` is when an `every` timing was set; daily times follow
 * the clock. Built from local dates, so a clock change moves a daily run with
 * the clock rather than by an hour.
 */
export function nextRunAt(timing: ScheduleTiming, anchor: number, after: number): number | null {
  switch (timing.kind) {
    case 'every': {
      const step = timing.hours * HOUR_MS;
      if (!(step > 0)) return null;
      const steps = Math.max(1, Math.floor((after - anchor) / step) + 1);
      return anchor + steps * step;
    }
    case 'daily': {
      const time = parseTime(timing.time);
      if (!time) return null;
      const from = new Date(after);
      // A week and a day covers any weekday from a Friday evening.
      for (let day = 0; day <= 8; day++) {
        const slot = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, time.hours, time.minutes);
        if (slot.getTime() <= after) continue;
        const weekday = slot.getDay();
        if (timing.weekdaysOnly && (weekday === 0 || weekday === 6)) continue;
        return slot.getTime();
      }
      return null;
    }
  }
}

/** When the schedule runs next, or null while paused. */
export function scheduleNextRun(schedule: SkillSchedule): number | null {
  if (schedule.paused) return null;
  return nextRunAt(schedule.timing, schedule.scheduledFrom, schedule.checkedThrough);
}

/**
 * The latest scheduled time that has come since the schedule was last
 * checked (after `checkedThrough`, at or before `now`), or null when none
 * has. The latest rather than the first: after a long sleep, the time that
 * matters is the one just gone, not one from hours ago.
 */
export function scheduleDueAt(schedule: SkillSchedule, now: number): number | null {
  let due = scheduleNextRun(schedule);
  if (due === null || due > now) return null;
  const { timing, scheduledFrom } = schedule;
  if (timing.kind === 'every') {
    const step = timing.hours * HOUR_MS;
    return scheduledFrom + Math.floor((now - scheduledFrom) / step) * step;
  }
  // Daily: one step a day, so even a year away is a few hundred.
  for (;;) {
    const next = nextRunAt(timing, scheduledFrom, due);
    if (next === null || next > now) return due;
    due = next;
  }
}

/** The timing in a few words, for the schedule list. */
export function describeTiming(timing: ScheduleTiming): string {
  switch (timing.kind) {
    case 'every':
      return timing.hours === 1 ? 'Every hour' : `Every ${timing.hours} hours`;
    case 'daily':
      return `${timing.weekdaysOnly ? 'Weekdays' : 'Daily'} at ${timing.time}`;
  }
}

/** The thread's first message. Agent-neutral: it names the skill in plain
 *  words, which every agent with Agent Skills acts on, rather than one
 *  agent's command syntax. */
export function skillRunPrompt(run: Pick<SkillRun, 'skill' | 'note'>): string {
  const note = run.note.trim();
  return note ? `${skillLine(run.skill)}\n\n${note}` : `Use the \`${run.skill}\` skill.`;
}
