import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import AddRepoButton from './AddRepoButton.svelte';
import { store } from '../stores/sessions.svelte.js';

const bridge = mockGroveBench as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete bridge.addRepo;
  store.clearError();
});

describe('AddRepoButton', () => {
  it('says why a picked folder was refused', async () => {
    bridge.addRepo = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'repo:select': Error: C:\\notes is not a git repository, so it can't be added as a project."),
    );
    render(AddRepoButton);

    await fireEvent.click(screen.getByRole('button', { name: 'Add a project' }));

    await waitFor(() => expect(store.error).toBe("C:\\notes is not a git repository, so it can't be added as a project."));
  });
});
