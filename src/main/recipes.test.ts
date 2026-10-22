import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Recipe, RecipeInput } from '../shared/recipes.js';
import { MAX_RECIPE_SESSIONS, MISSED_AFTER_MS } from '../shared/recipes.js';

/** app-state.json's recipes, as the scheduler and IPC see them. */
const saved = vi.hoisted(() => ({ recipes: [] as Recipe[] | null, writes: [] as boolean[] }));

vi.mock('./app-state.js', () => ({
  loadRecipes: () => (saved.recipes ? structuredClone(saved.recipes) : null),
  saveRecipes: (recipes: Recipe[], now: boolean) => {
    saved.recipes = structuredClone(recipes);
    saved.writes.push(now);
  },
}));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { deleteRecipe, listRecipes, recordRecipeRun, saveRecipe, startRecipeScheduler, stopRecipeScheduler, takeDue } from './recipes.js';
import { IPC } from '../shared/types.js';

const HOUR = 3_600_000;

const input = (over: Partial<RecipeInput> = {}): RecipeInput => ({
  repoPath: '/repo',
  name: 'Next issue',
  agentId: '',
  start: 'new',
  permissionMode: '',
  skill: 'work-linear-issue',
  prompt: 'Take the top agent-ready issue.',
  schedule: { kind: 'every', hours: 2 },
  maxOpen: 1,
  paused: false,
  ...over,
});

beforeEach(() => {
  saved.recipes = [];
  saved.writes = [];
});

describe('saveRecipe', () => {
  it('adds a new recipe whose schedule counts from now, saved straight away', () => {
    const recipe = saveRecipe(input(), 1000);
    expect(recipe.id).toBeTruthy();
    expect(recipe).toMatchObject({ name: 'Next issue', scheduledFrom: 1000, checkedThrough: 1000, sessionIds: [] });
    expect(listRecipes()).toEqual([recipe]);
    expect(saved.writes).toEqual([true]);
  });

  it('keeps the schedule position and history when only the message changes', () => {
    const first = saveRecipe(input(), 1000);
    recordRecipeRun(first.id, { sessionId: 's1' }, 2000);
    const edited = saveRecipe({ ...input({ prompt: 'Something else' }), id: first.id }, 5000);
    expect(edited).toMatchObject({ scheduledFrom: 1000, checkedThrough: 1000, sessionIds: ['s1'], prompt: 'Something else' });
    expect(edited.lastOutcome).toEqual({ at: 2000, sessionId: 's1' });
  });

  it('restarts the schedule from now when it changes or is resumed', () => {
    const first = saveRecipe(input({ paused: true }), 1000);
    expect(saveRecipe({ ...input({ paused: false }), id: first.id }, 5000)).toMatchObject({ scheduledFrom: 5000, checkedThrough: 5000 });
    expect(saveRecipe({ ...input({ schedule: { kind: 'every', hours: 3 } }), id: first.id }, 9000)).toMatchObject({ scheduledFrom: 9000 });
  });

  it('refuses a recipe with nothing to send, a bad time, or an id that is gone', () => {
    expect(() => saveRecipe(input({ skill: '', prompt: '  ' }))).toThrow('Write a first message or name a skill');
    expect(() => saveRecipe(input({ schedule: { kind: 'daily', time: '25:00', weekdaysOnly: false } }))).toThrow('24-hour time');
    expect(() => saveRecipe(input({ name: ' ' }))).toThrow('Give the recipe a name');
    expect(() => saveRecipe({ ...input(), id: 'gone' })).toThrow('That recipe was deleted');
    expect(saved.recipes).toEqual([]);
  });

  it("won't save over recipes it couldn't read", () => {
    saved.recipes = null;
    expect(() => saveRecipe(input())).toThrow("can't be read");
  });
});

describe('deleteRecipe', () => {
  it('takes the recipe out', () => {
    const a = saveRecipe(input({ name: 'A' }), 1);
    const b = saveRecipe(input({ name: 'B' }), 1);
    deleteRecipe(a.id);
    expect(listRecipes().map((r) => r.id)).toEqual([b.id]);
  });
});

describe('recordRecipeRun', () => {
  it('notes the outcome and keeps the last threads, saved within a moment', () => {
    const recipe = saveRecipe(input(), 1);
    for (let i = 0; i < MAX_RECIPE_SESSIONS + 2; i++) recordRecipeRun(recipe.id, { sessionId: `s${i}` }, 10 + i);
    const after = listRecipes()[0];
    expect(after.sessionIds).toHaveLength(MAX_RECIPE_SESSIONS);
    expect(after.sessionIds.at(-1)).toBe(`s${MAX_RECIPE_SESSIONS + 1}`);
    expect(saved.writes.at(-1)).toBe(false);
  });

  it('ignores a recipe deleted meanwhile and a malformed outcome', () => {
    expect(recordRecipeRun('gone', { skipped: 'x' })).toBeNull();
    const recipe = saveRecipe(input(), 1);
    expect(recordRecipeRun(recipe.id, { sessionId: 42 })).toBeNull();
  });
});

describe('takeDue', () => {
  const recipe = (over: Partial<Recipe> = {}): Recipe => ({
    ...input(), id: 'r1', scheduledFrom: 0, checkedThrough: 0, sessionIds: [], ...over,
  });

  it('runs a recipe whose time has come and marks it checked', () => {
    const due = takeDue([recipe()], 2 * HOUR + 30_000);
    expect(due.run).toEqual(['r1']);
    expect(due.changed).toBe(true);
    expect(due.recipes[0].checkedThrough).toBe(2 * HOUR + 30_000);
    // Checked: the same time doesn't run twice.
    expect(takeDue(due.recipes, 2 * HOUR + 90_000).run).toEqual([]);
  });

  it('leaves recipes alone before their time, and paused or manual ones', () => {
    const due = takeDue([
      recipe({ id: 'early' }),
      recipe({ id: 'paused', paused: true }),
      recipe({ id: 'manual', schedule: { kind: 'manual' } }),
    ], 2 * HOUR - 1);
    expect(due).toMatchObject({ run: [], changed: false });
    expect(takeDue([recipe({ id: 'paused', paused: true })], 10 * HOUR).changed).toBe(false);
  });

  it('skips a time found too late, once for any number missed', () => {
    const now = 10 * HOUR;
    const due = takeDue([recipe()], now);
    expect(due.run).toEqual([]);
    expect(due.recipes[0].lastOutcome?.skipped).toMatch(/closed or the computer was asleep/);
    expect(due.recipes[0].checkedThrough).toBe(now);
    // Just inside the grace period it still runs.
    expect(takeDue([recipe()], 2 * HOUR + MISSED_AFTER_MS).run).toEqual(['r1']);
  });
});

describe('startRecipeScheduler', () => {
  afterEach(() => {
    stopRecipeScheduler();
    vi.useRealTimers();
  });

  const fakeWindow = () => {
    const send = vi.fn();
    return { send, win: { isDestroyed: () => false, webContents: { send } } as unknown as Electron.BrowserWindow };
  };

  it('sends the list, then the due id, and checks every minute after', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const recipe = saveRecipe(input({ schedule: { kind: 'every', hours: 1 } }), 0);
    const { send, win } = fakeWindow();
    startRecipeScheduler(() => win);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR);
    expect(send.mock.calls.map((c) => c[0])).toEqual([IPC.RECIPES_CHANGED, IPC.RECIPE_DUE]);
    expect(send).toHaveBeenLastCalledWith(IPC.RECIPE_DUE, recipe.id);
  });

  it('takes nothing while there is no window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    saveRecipe(input({ schedule: { kind: 'every', hours: 1 } }), 0);
    let win: Electron.BrowserWindow | null = null;
    startRecipeScheduler(() => win);
    vi.advanceTimersByTime(HOUR);
    expect(saved.recipes?.[0].checkedThrough).toBe(0);
    const fake = fakeWindow();
    win = fake.win;
    vi.advanceTimersByTime(60_000);
    expect(fake.send).toHaveBeenCalledWith(IPC.RECIPE_DUE, expect.any(String));
  });
});
