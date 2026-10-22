import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { Recipe } from '../../shared/recipes.js';

const startThreadFor = vi.hoisted(() => vi.fn());
vi.mock('./draft.svelte.js', () => ({ draftStore: { startThreadFor } }));

import { recipesStore } from './recipes.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'r1',
  repoPath: '/repo',
  name: 'Next issue',
  agentId: '',
  start: 'new',
  permissionMode: 'plan',
  skill: 'work-linear-issue',
  prompt: 'Take the top agent-ready issue.',
  schedule: { kind: 'every', hours: 2 },
  maxOpen: 1,
  paused: false,
  scheduledFrom: 0,
  checkedThrough: 0,
  sessionIds: [],
  ...over,
});

const thread = (id: string, status: 'running' | 'stopped') =>
  ({ id, branch: 'b', repoPath: '/repo', status, createdAt: 0 }) as (typeof sessionStore.sessions)[number];

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.repos = ['/repo'];
  sessionStore.sessions = [];
  sessionStore.deferredResume = {};
  sessionStore.error = null;
  recipesStore.list = [];
  recipesStore.starting = {};
  startThreadFor.mockResolvedValue({ id: 'new1' });
  mockGroveBench.recordRecipeRun.mockImplementation(async (id: string, outcome: object) => ({ ...recipe({ id }), lastOutcome: { at: 1, ...outcome } }));
});

describe('recipesStore.run', () => {
  it('opens the thread when run by hand, on its own agent only, and notes it', async () => {
    expect(await recipesStore.run(recipe({ agentId: 'gemini' }))).toBe(true);
    expect(startThreadFor).toHaveBeenCalledWith({
      repoPath: '/repo',
      text: 'Use the `work-linear-issue` skill for this task.\n\nTake the top agent-ready issue.',
      agentId: 'gemini',
      start: { kind: 'new', branchName: '', baseBranch: '' },
      controls: { permissionMode: 'plan' },
      focus: true,
      strictAgent: true,
      quiet: true,
    });
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { sessionId: 'new1' });
  });

  it('starts a scheduled run without taking the screen', async () => {
    await recipesStore.run(recipe({ start: 'folder', permissionMode: '' }), { scheduled: true });
    const setup = startThreadFor.mock.calls[0][0];
    expect(setup).toMatchObject({ start: { kind: 'folder' }, focus: false });
    expect(setup).not.toHaveProperty('controls');
  });

  it('skips a scheduled run while its threads are still open, but not one by hand', async () => {
    sessionStore.sessions = [thread('old', 'running')];
    const capped = recipe({ sessionIds: ['old'] });
    expect(await recipesStore.run(capped, { scheduled: true })).toBe(false);
    expect(startThreadFor).not.toHaveBeenCalled();
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { skipped: '1 thread from it is still open' });
    expect(sessionStore.error).toBeNull();

    expect(await recipesStore.run(capped)).toBe(true);
  });

  it('counts a thread waiting to reconnect after a restart or wake, not a closed one', async () => {
    sessionStore.sessions = [thread('waiting', 'stopped'), thread('closed', 'stopped')];
    sessionStore.deferResume('waiting');
    expect(recipesStore.openThreads(recipe({ sessionIds: ['waiting', 'closed'] }))).toBe(1);
    expect(await recipesStore.run(recipe({ sessionIds: ['waiting'] }), { scheduled: true })).toBe(false);
    expect(await recipesStore.run(recipe({ sessionIds: ['closed'] }), { scheduled: true })).toBe(true);
  });

  it('notes why a thread did not start, and says so with the recipe named', async () => {
    startThreadFor.mockResolvedValue({ error: "Branch 'x' already exists." });
    expect(await recipesStore.run(recipe(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { error: "Branch 'x' already exists." });
    expect(sessionStore.error).toBe(`Recipe "Next issue" didn't start a thread: Branch 'x' already exists.`);
  });

  it('notes a start that threw rather than lose the run', async () => {
    startThreadFor.mockRejectedValue(new Error('IPC gone'));
    expect(await recipesStore.run(recipe(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { error: 'IPC gone' });
    expect(recipesStore.starting).toEqual({});
  });

  it('notes a scheduled run that came while a run by hand was starting', async () => {
    recipesStore.starting = { r1: true };
    expect(await recipesStore.run(recipe(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { skipped: 'a run by hand was starting' });
    mockGroveBench.recordRecipeRun.mockClear();
    expect(await recipesStore.run(recipe())).toBe(false);
    expect(mockGroveBench.recordRecipeRun).not.toHaveBeenCalled();
  });
});

describe('recipesStore.load', () => {
  it('asks again while the file is locked', async () => {
    mockGroveBench.listRecipes.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('ipc')).mockResolvedValueOnce([recipe()]);
    await recipesStore.load(0);
    expect(mockGroveBench.listRecipes).toHaveBeenCalledTimes(3);
    expect(recipesStore.list.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('a due run', () => {
  it('fetches the list when the recipe is missing from it, then runs', async () => {
    let due: (id: string) => void = () => {};
    mockGroveBench.onRecipeDue.mockImplementation((cb: (id: string) => void) => { due = cb; return () => {}; });
    mockGroveBench.listRecipes.mockResolvedValue([]);
    recipesStore.init();
    await vi.waitFor(() => expect(mockGroveBench.listRecipes).toHaveBeenCalled());

    mockGroveBench.listRecipes.mockResolvedValue([recipe({ id: 'late' })]);
    due('late');
    await vi.waitFor(() => expect(startThreadFor).toHaveBeenCalled());
    expect(startThreadFor.mock.calls[0][0]).toMatchObject({ focus: false });
  });
});
