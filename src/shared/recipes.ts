import type { PermissionMode } from './types.js';

/**
 * Recipes: a saved way to start a thread (project, agent, where it runs, mode,
 * skill and first message), run by hand or on a schedule. A skill says how to
 * do a job; a recipe says when and where to start a thread that does it.
 * Main keeps them (recipes.ts) and says when one is due; the renderer starts
 * the thread, as it does every other.
 */

/** When a recipe runs by itself. Times are the computer's local time. */
export type RecipeSchedule =
  | { kind: 'manual' }
  /** Every `hours` hours, counted from when the schedule was set. */
  | { kind: 'every'; hours: number }
  /** Each day at `time` (HH:MM, 24-hour), or Monday to Friday only. */
  | { kind: 'daily'; time: string; weekdaysOnly: boolean };

/** What the recipe's last run did. */
export interface RecipeOutcome {
  at: number;
  /** The thread it started. */
  sessionId?: string;
  /** Why it didn't start one (a cap, or a time missed while Grove was closed). */
  skipped?: string;
  /** Why the thread couldn't start. */
  error?: string;
}

/** What the user sets in the Recipes dialog. */
export interface RecipeFields {
  repoPath: string;
  name: string;
  /** The agent to run on; '' for the default agent at the time it runs. */
  agentId: string;
  /** A new branch in its own worktree, or the project folder itself. */
  start: 'new' | 'folder';
  /** Mode to start in; '' for the agent's saved default. */
  permissionMode: PermissionMode | '';
  /** A skill to ask for by name; '' for none. */
  skill: string;
  /** The first message. */
  prompt: string;
  schedule: RecipeSchedule;
  /** Scheduled runs only: no run starts while this many threads the recipe
   *  started are still open (not closed or deleted). */
  maxOpen: number;
  /** Scheduled runs are off; Run still works. */
  paused: boolean;
}

export interface Recipe extends RecipeFields {
  id: string;
  /** When the schedule was last set or resumed. An `every` schedule counts
   *  from here, and no time before it runs. */
  scheduledFrom: number;
  /** Scheduled times up to here have been run or skipped. */
  checkedThrough: number;
  lastOutcome?: RecipeOutcome;
  /** Threads its runs started, oldest first (the last MAX_RECIPE_SESSIONS). */
  sessionIds: string[];
}

/** New recipes have no id yet. */
export type RecipeInput = RecipeFields & { id?: string };

export const MAX_RECIPE_SESSIONS = 20;
export const MAX_OPEN_LIMIT = 10;
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
 * The first scheduled time strictly after `after`, or null for a manual (or
 * broken) schedule. `anchor` is when an `every` schedule was set; daily times
 * follow the clock. Built from local dates, so a clock change moves a daily
 * run with the clock rather than by an hour.
 */
export function nextRunAt(schedule: RecipeSchedule, anchor: number, after: number): number | null {
  switch (schedule.kind) {
    case 'manual':
      return null;
    case 'every': {
      const step = schedule.hours * HOUR_MS;
      if (!(step > 0)) return null;
      const steps = Math.max(1, Math.floor((after - anchor) / step) + 1);
      return anchor + steps * step;
    }
    case 'daily': {
      const time = parseTime(schedule.time);
      if (!time) return null;
      const from = new Date(after);
      // A week and a day covers any weekday from a Friday evening.
      for (let day = 0; day <= 8; day++) {
        const slot = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, time.hours, time.minutes);
        if (slot.getTime() <= after) continue;
        const weekday = slot.getDay();
        if (schedule.weekdaysOnly && (weekday === 0 || weekday === 6)) continue;
        return slot.getTime();
      }
      return null;
    }
  }
}

/** When the recipe runs next by itself, or null when it won't. */
export function recipeNextRun(recipe: Recipe): number | null {
  if (recipe.paused) return null;
  return nextRunAt(recipe.schedule, recipe.scheduledFrom, recipe.checkedThrough);
}

/** The schedule in a few words, for the recipe list. */
export function describeSchedule(schedule: RecipeSchedule): string {
  switch (schedule.kind) {
    case 'manual':
      return 'Run by hand';
    case 'every':
      return schedule.hours === 1 ? 'Every hour' : `Every ${schedule.hours} hours`;
    case 'daily':
      return `${schedule.weekdaysOnly ? 'Weekdays' : 'Daily'} at ${schedule.time}`;
  }
}

/** The thread's first message. Agent-neutral: it names the skill rather than
 *  using one agent's command syntax for it. */
export function recipePrompt(recipe: Pick<RecipeFields, 'skill' | 'prompt'>): string {
  const prompt = recipe.prompt.trim();
  const skill = recipe.skill.trim();
  if (!skill) return prompt;
  return prompt ? `Use the \`${skill}\` skill for this task.\n\n${prompt}` : `Use the \`${skill}\` skill.`;
}
