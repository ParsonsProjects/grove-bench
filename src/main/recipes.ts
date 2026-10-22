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
import { MAX_RECIPE_SESSIONS, MISSED_AFTER_MS, recipeNextRun, type Recipe } from '../shared/recipes.js';
import { loadRecipes, saveRecipes } from './app-state.js';
import { outcomeInputSchema, recipeInputSchema } from './recipe-schema.js';
import { logger } from './logger.js';

/** How often the scheduler looks for due recipes. Schedules are to the minute. */
const TICK_MS = 60_000;

function readAll(): Recipe[] {
  const recipes = loadRecipes();
  if (!recipes) throw new Error("Recipes can't be read right now. Try again in a moment.");
  return recipes;
}

export function listRecipes(): Recipe[] {
  return loadRecipes() ?? [];
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

/** Note what a run did. The recipe as saved, or null when it was deleted
 *  while its thread started. */
export function recordRecipeRun(id: string, raw: unknown, now = Date.now()): Recipe | null {
  const parsed = outcomeInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const recipes = loadRecipes();
  const old = recipes?.find((r) => r.id === id);
  if (!recipes || !old) return null;
  const { sessionId } = parsed.data;
  const recipe: Recipe = {
    ...old,
    lastOutcome: { at: now, ...parsed.data },
    sessionIds: sessionId ? [...old.sessionIds, sessionId].slice(-MAX_RECIPE_SESSIONS) : old.sessionIds,
  };
  saveRecipes(recipes.map((r) => (r.id === id ? recipe : r)), false);
  return recipe;
}

/**
 * The recipes due at `now`: the ids to run, and the list with every due
 * recipe marked checked up to now. A time found more than MISSED_AFTER_MS
 * late is skipped and noted instead, and several missed times count as one.
 * Exported for tests.
 */
export function takeDue(recipes: Recipe[], now: number): { recipes: Recipe[]; run: string[]; changed: boolean } {
  const run: string[] = [];
  let changed = false;
  const next = recipes.map((recipe) => {
    const due = recipeNextRun(recipe);
    if (due === null || due > now) return recipe;
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

let timer: ReturnType<typeof setInterval> | null = null;

/** Look for due recipes now and every minute after, and ask the window to
 *  start their threads. Nothing is taken while there is no window, so a run
 *  isn't marked done with nobody to start it. */
export function startRecipeScheduler(getWindow: () => BrowserWindow | null): void {
  if (timer) return;
  const tick = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const recipes = loadRecipes();
    if (!recipes) return; // the file is locked for a moment: next tick
    const due = takeDue(recipes, Date.now());
    if (!due.changed) return;
    saveRecipes(due.recipes, false);
    win.webContents.send(IPC.RECIPES_CHANGED, due.recipes);
    for (const id of due.run) {
      logger.info(`[recipes] ${id} is due`);
      win.webContents.send(IPC.RECIPE_DUE, id);
    }
  };
  timer = setInterval(tick, TICK_MS);
  tick();
}

export function stopRecipeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
