import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { Recipe } from '../../shared/recipes.js';

const startThreadFor = vi.hoisted(() => vi.fn());
vi.mock('./draft.svelte.js', () => ({ draftStore: { startThreadFor } }));

import { recipesStore } from './recipes.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { agentsStore } from './agents.svelte.js';

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
  sessionStore.error = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
  recipesStore.list = [];
  startThreadFor.mockResolvedValue('new1');
  mockGroveBench.recordRecipeRun.mockImplementation(async (id: string, outcome: object) => ({ ...recipe({ id }), lastOutcome: { at: 1, ...outcome } }));
});

describe('recipesStore.run', () => {
  it('opens the thread when run by hand, with its mode and message, and notes it', async () => {
    expect(await recipesStore.run(recipe())).toBe(true);
    expect(startThreadFor).toHaveBeenCalledWith({
      repoPath: '/repo',
      text: 'Use the `work-linear-issue` skill for this task.\n\nTake the top agent-ready issue.',
      start: { kind: 'new', branchName: '', baseBranch: '' },
      controls: { permissionMode: 'plan' },
      focus: true,
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

  it('does not count closed threads', async () => {
    sessionStore.sessions = [thread('old', 'stopped')];
    expect(await recipesStore.run(recipe({ sessionIds: ['old'] }), { scheduled: true })).toBe(true);
  });

  it("won't swap a removed agent for the default one", async () => {
    agentsStore.loaded = true;
    expect(await recipesStore.run(recipe({ agentId: 'gemini' }), { scheduled: true })).toBe(false);
    expect(startThreadFor).not.toHaveBeenCalled();
    expect(sessionStore.error).toMatch(/turned off or was removed/);
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { error: 'Its agent is turned off or was removed' });
  });

  it('notes a thread that could not start', async () => {
    startThreadFor.mockResolvedValue(null);
    expect(await recipesStore.run(recipe())).toBe(false);
    expect(mockGroveBench.recordRecipeRun).toHaveBeenCalledWith('r1', { error: "The thread couldn't start" });
  });
});
