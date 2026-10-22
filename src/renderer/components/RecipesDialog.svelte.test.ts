import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import RecipesDialog from './RecipesDialog.svelte';
import { recipesStore } from '../stores/recipes.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { Recipe, RecipeInput } from '../../shared/recipes.js';

const recipe: Recipe = {
  id: 'r1', repoPath: '/repo', name: 'Next issue', agentId: '', start: 'new', permissionMode: '',
  skill: 'work-linear-issue', prompt: 'Take the top agent-ready issue.', schedule: { kind: 'every', hours: 2 },
  maxOpen: 1, paused: false, scheduledFrom: 0, checkedThrough: 0, sessionIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  recipesStore.list = [recipe, { ...recipe, id: 'other', repoPath: '/elsewhere', name: 'Not this project' }];
  mockGroveBench.saveRecipe.mockImplementation(async (input: RecipeInput) => ({ ...recipe, ...input, id: input.id ?? 'new' }));
});

afterEach(() => {
  cleanup();
  recipesStore.list = [];
  store.repos = [];
});

describe('RecipesDialog', () => {
  it("lists the project's recipes only", () => {
    render(RecipesDialog, { repoPath: '/repo', onclose: () => {} });
    expect(screen.getByText('Next issue')).toBeInTheDocument();
    expect(screen.queryByText('Not this project')).toBeNull();
    expect(screen.getByText(/Every 2 hours/)).toBeInTheDocument();
  });

  it('edits a recipe and saves a plain copy of it', async () => {
    render(RecipesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Next issue');
    await fireEvent.input(name, { target: { value: 'Next two issues' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockGroveBench.saveRecipe).toHaveBeenCalled());
    const sent = mockGroveBench.saveRecipe.mock.calls[0][0];
    // What goes over IPC must survive structured cloning (no state proxies).
    expect(structuredClone(sent)).toEqual({
      id: 'r1', repoPath: '/repo', name: 'Next two issues', agentId: '', start: 'new', permissionMode: '',
      skill: 'work-linear-issue', prompt: 'Take the top agent-ready issue.', schedule: { kind: 'every', hours: 2 },
      maxOpen: 1, paused: false,
    });
    await waitFor(() => expect(screen.getByText('Next two issues')).toBeInTheDocument());
  });

  it("shows main's reason when a save is refused", async () => {
    mockGroveBench.saveRecipe.mockRejectedValue(new Error("Error invoking remote method 'recipes:save': Error: Write a first message or name a skill"));
    render(RecipesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Empty' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Write a first message or name a skill')).toBeInTheDocument();
  });

  it('pauses a scheduled recipe', async () => {
    render(RecipesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mockGroveBench.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', paused: true })));
  });
});
