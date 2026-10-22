/**
 * Recipes in main: saving them, and the scheduler that says when one is due.
 * The thread itself is started by the renderer (stores/recipes.svelte.ts),
 * which starts every thread, so a recipe's run shows and behaves like one
 * started by hand. The scheduler only runs while Grove is open; a time it
 * finds more than MISSED_AFTER_MS late is skipped, not caught up.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import { MAX_RECIPE_SESSIONS, MISSED_AFTER_MS, recipeDueAt, type Recipe, type RecipeOutcome } from '../shared/recipes.js';
import { loadRecipes, saveRecipes, updateRecipes } from './app-state.js';
import { outcomeInputSchema, recipeInputSchema } from './recipe-schema.js';
import { logger } from './logger.js';

/** How often the scheduler looks for due recipes. Schedules are to the minute. */
const TICK_MS = 60_000;
/** How long a due run waits for the window to say what it did (a new
 *  worktree can take a while on Windows) before it is noted as not started. */
const ANSWER_WAIT_MS = 5 * 60_000;

/** Due runs sent to the window and not answered yet (recordRecipeRun), with
 *  when they were sent. */
const awaiting = new Map<string, number>();

function readAll(): Recipe[] {
  const recipes = loadRecipes();
  if (!recipes) throw new Error("Recipes can't be read right now. Try again in a moment.");
  return recipes;
}

/** The recipes, or null while app-state.json can't be read (a passing
 *  lock), so "none" is never mistaken for the real list. */
export function listRecipes(): Recipe[] | null {
  return loadRecipes();
}

/** Save a new or edited recipe from the renderer. A new, changed or resumed
 *  schedule counts from `now`, so no time before it runs. */
export function saveRecipe(raw: unknown, now = Date.now()): Recipe {
  const parsed = recipeInputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "That recipe can't be saved");
  const input = parsed.data;
  const recipes = readAll();
  const old = input.id ? recipes.find((r) => r.id === input.id) : undefined;
  if (input.id && !old) throw new Error('That recipe was deleted');
  const keep = old && old.paused === input.paused && JSON.stringify(old.schedule) === JSON.stringify(input.schedule);
  const recipe: Recipe = {
    ...input,
    id: old?.id ?? randomUUID(),
    scheduledFrom: keep ? old.scheduledFrom : now,
    checkedThrough: keep ? old.checkedThrough : now,
    sessionIds: old?.sessionIds ?? [],
    ...(old?.lastOutcome ? { lastOutcome: old.lastOutcome } : {}),
  };
  saveRecipes(old ? recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...recipes, recipe], true);
  return recipe;
}

export function deleteRecipe(id: string): void {
  const recipes = readAll();
  saveRecipes(recipes.filter((r) => r.id !== id), true);
}

/** Note a run's outcome, and the thread it started (which the open-thread
 *  cap counts). Applied once app-state.json can be read, if it can't now. */
function applyOutcome(id: string, outcome: Omit<RecipeOutcome, 'at'>, now: number): void {
  updateRecipes((recipes) => recipes.map((r) => (r.id !== id ? r : {
    ...r,
    lastOutcome: { at: now, ...outcome },
    sessionIds: outcome.sessionId ? [...r.sessionIds, outcome.sessionId].slice(-MAX_RECIPE_SESSIONS) : r.sessionIds,
  })));
}

/** Note what a run did. The recipe as saved, or null when it was deleted
 *  while its thread started, or the file can't be read just now (the record
 *  is saved once it can). */
export function recordRecipeRun(id: string, raw: unknown, now = Date.now()): Recipe | null {
  const parsed = outcomeInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  awaiting.delete(id);
  applyOutcome(id, parsed.data, now);
  const recipes = loadRecipes();
  if (!recipes) logger.warn(`[recipes] app-state.json can't be read; ${id}'s run is saved once it can`);
  return recipes?.find((r) => r.id === id) ?? null;
}

/**
 * The recipes due at `now`: the ids to run, and the list with every due
 * recipe marked checked up to now. Only the latest time since the last check
 * counts: it runs if it is at most MISSED_AFTER_MS late, and is skipped and
 * noted otherwise. Earlier times missed meanwhile are dropped. Exported for
 * tests.
 */
export function takeDue(recipes: Recipe[], now: number): { recipes: Recipe[]; run: string[]; changed: boolean } {
  const run: string[] = [];
  let changed = false;
  const next = recipes.map((recipe) => {
    const due = recipeDueAt(recipe, now);
    if (due === null) return recipe;
    changed = true;
    if (now - due <= MISSED_AFTER_MS) {
      run.push(recipe.id);
      return { ...recipe, checkedThrough: now };
    }
    return {
      ...recipe,
      checkedThrough: now,
      lastOutcome: { at: now, skipped: 'it was due while Grove was closed or the computer was asleep' },
    };
  });
  return { recipes: next, run, changed };
}

/** Note the runs the window never answered (it was reloading, say), so the
 *  recipe doesn't go on showing its previous run. Whether any were. */
function expireUnanswered(now: number): boolean {
  let any = false;
  for (const [id, sentAt] of awaiting) {
    if (now - sentAt < ANSWER_WAIT_MS) continue;
    awaiting.delete(id);
    logger.warn(`[recipes] no answer from the window about ${id}'s run`);
    applyOutcome(id, { error: "The window didn't say it started a thread (it may have been reloading)" }, now);
    any = true;
  }
  return any;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Set once the app starts shutting down, so a restore that finishes late
 *  can't start the scheduler again. */
let stopped = false;

/** Look for due recipes now and every minute after, and ask the window to
 *  start their threads. Nothing is taken while there is no window, so a run
 *  isn't marked done with nobody to start it. */
export function startRecipeScheduler(getWindow: () => BrowserWindow | null): void {
  if (timer || stopped) return;
  const tick = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const expired = expireUnanswered(now);
    const recipes = loadRecipes();
    if (!recipes) return; // the file is locked for a moment: next tick
    const due = takeDue(recipes, now);
    if (due.changed) saveRecipes(due.recipes, false);
    if (due.changed || expired) win.webContents.send(IPC.RECIPES_CHANGED, due.recipes);
    for (const id of due.run) {
      logger.info(`[recipes] ${id} is due`);
      awaiting.set(id, now);
      win.webContents.send(IPC.RECIPE_DUE, id);
    }
  };
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Stop for good: the app is shutting down or restarting to update. */
export function stopRecipeScheduler(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

export function resetRecipeSchedulerForTests(): void {
  stopRecipeScheduler();
  stopped = false;
  awaiting.clear();
}
