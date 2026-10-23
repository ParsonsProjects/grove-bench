import { z } from 'zod';
import { PERMISSION_MODES } from '../shared/types.js';
import { MAX_NOTE_LENGTH, MAX_OPEN_LIMIT, MAX_SCHEDULE_SESSIONS, parseTime, type SkillSchedule, type SkillScheduleInput } from '../shared/skill-schedules.js';

/**
 * Checks for skill schedules, both as saved in app-state.json and as the
 * renderer sends them to be saved. Kept apart from skill-schedules.ts so
 * app-state.ts can use them without importing the module that imports it.
 */

const timingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('every'),
    hours: z.number({ error: 'Enter how many hours apart' }).int('Use whole hours').min(1, 'Run it at least an hour apart').max(24 * 7, 'Run it at least once a week'),
  }),
  z.object({
    kind: z.literal('daily'),
    time: z.string().refine((t) => parseTime(t) !== null, 'Use a 24-hour time such as 09:00'),
    weekdaysOnly: z.boolean(),
  }),
]);

const fields = {
  repoPath: z.string().min(1),
  agentId: z.string().min(1, 'Pick an agent'),
  skill: z.string().trim().min(1, 'Pick a skill').max(64),
  note: z.string().max(MAX_NOTE_LENGTH, `Keep the note under ${MAX_NOTE_LENGTH} characters`),
  start: z.enum(['new', 'folder']),
  permissionMode: z.union([z.enum(PERMISSION_MODES), z.literal('')]),
  timing: timingSchema,
  maxOpen: z.number({ error: 'Enter how many open threads to allow' }).int('Use a whole number of threads').min(1, 'Allow at least 1 open thread').max(MAX_OPEN_LIMIT, `Allow at most ${MAX_OPEN_LIMIT} open threads`),
  paused: z.boolean(),
};

/** What the schedule form sends: the fields, plus the id when editing. */
export const scheduleInputSchema = z.object({ ...fields, id: z.string().min(1).optional() }) satisfies z.ZodType<SkillScheduleInput, unknown>;

const outcomeSchema = z.object({
  at: z.number(),
  sessionId: z.string().optional(),
  skipped: z.string().optional(),
  error: z.string().optional(),
});

const scheduleSchema = z.object({
  ...fields,
  id: z.string().min(1),
  scheduledFrom: z.number(),
  checkedThrough: z.number(),
  lastOutcome: outcomeSchema.optional(),
  sessionIds: z.array(z.string()).max(MAX_SCHEDULE_SESSIONS),
});

/** Keeps the well-formed schedules and drops the rest, so one bad entry
 *  doesn't lose them all. */
export const skillSchedulesSchema = z.array(z.unknown()).transform((raw): SkillSchedule[] =>
  raw.flatMap((r) => {
    const parsed = scheduleSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  }));

/** What the renderer reports after a run, minus the time main adds. */
export const outcomeInputSchema = outcomeSchema.omit({ at: true });
