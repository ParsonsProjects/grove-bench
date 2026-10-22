import { z } from 'zod';
import { PERMISSION_MODES } from '../shared/types.js';
import { MAX_OPEN_LIMIT, MAX_RECIPE_SESSIONS, parseTime, type Recipe, type RecipeInput } from '../shared/recipes.js';

/**
 * Checks for recipes, both as saved in app-state.json and as the renderer
 * sends them to be saved. Kept apart from recipes.ts so app-state.ts can use
 * them without importing the module that imports it.
 */

const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('every'), hours: z.number().int().min(1).max(24 * 7) }),
  z.object({
    kind: z.literal('daily'),
    time: z.string().refine((t) => parseTime(t) !== null, 'Use a 24-hour time such as 09:00'),
    weekdaysOnly: z.boolean(),
  }),
]);

const fields = {
  repoPath: z.string().min(1),
  name: z.string().trim().min(1, 'Give the recipe a name').max(80),
  agentId: z.string(),
  start: z.enum(['new', 'folder']),
  permissionMode: z.union([z.enum(PERMISSION_MODES), z.literal('')]),
  skill: z.string().trim().max(64),
  prompt: z.string().max(20_000),
  schedule: scheduleSchema,
  maxOpen: z.number().int().min(1).max(MAX_OPEN_LIMIT),
  paused: z.boolean(),
};

/** What the Recipes dialog sends: the fields, plus the id when editing. A
 *  recipe needs a message or a skill, or its thread would start empty. */
export const recipeInputSchema = z.object({ ...fields, id: z.string().min(1).optional() })
  .refine((r) => r.prompt.trim() !== '' || r.skill !== '', { message: 'Write a first message or name a skill', path: ['prompt'] }) satisfies z.ZodType<RecipeInput, unknown>;

const outcomeSchema = z.object({
  at: z.number(),
  sessionId: z.string().optional(),
  skipped: z.string().optional(),
  error: z.string().optional(),
});

const recipeSchema = z.object({
  ...fields,
  id: z.string().min(1),
  scheduledFrom: z.number(),
  checkedThrough: z.number(),
  lastOutcome: outcomeSchema.optional(),
  sessionIds: z.array(z.string()).max(MAX_RECIPE_SESSIONS),
});

/** Keeps the well-formed recipes and drops the rest, so one bad entry doesn't
 *  lose them all. */
export const recipesSchema = z.array(z.unknown()).transform((raw): Recipe[] =>
  raw.flatMap((r) => {
    const parsed = recipeSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  }));

/** What the renderer reports after a run, minus the time main adds. */
export const outcomeInputSchema = outcomeSchema.omit({ at: true });
