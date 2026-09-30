import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import AddRepoButton from './AddRepoButton.svelte';
import { store } from '../stores/sessions.svelte.js';

afterEach(() => {
  cleanup();
  store.clearError();
});

describe('AddRepoButton', () => {
  it('says why a picked folder was refused', async () => {
    mockGroveBench.addRepo.mockRejectedValueOnce(
      new Error("Error invoking remote method 'repo:select': Error: The project folder C:\\notes wasn't found."),
    );
    render(AddRepoButton);

    await fireEvent.click(screen.getByRole('button', { name: 'Add a project' }));

    await waitFor(() => expect(store.error).toBe("The project folder C:\\notes wasn't found."));
  });
});
