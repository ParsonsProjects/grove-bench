import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import FilesKeptBlock from './FilesKeptBlock.svelte';
import { messageStore } from '../stores/messages.svelte.js';

const SID = 'kept-session';

beforeEach(() => {
  mockGroveBench.bringBackFiles.mockReset();
  mockGroveBench.bringBackFiles.mockResolvedValue(undefined);
  messageStore.setIsRunning(SID, false);
});

afterEach(() => {
  cleanup();
  messageStore.setIsRunning(SID, false);
});

describe('FilesKeptBlock', () => {
  // Each line names its own copy, so an older line still brings back its own.
  it('brings back the copy it was given', async () => {
    render(FilesKeptBlock, { sessionId: SID, reason: 'rewind', copy: 'c1' });
    expect(screen.getByText('Kept a copy of the files from before the rewind.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));
    expect(mockGroveBench.bringBackFiles).toHaveBeenCalledWith(SID, 'c1');
  });

  it('says what each kind of copy holds', () => {
    render(FilesKeptBlock, { sessionId: SID, reason: 'bring_back', copy: 'c2' });
    expect(screen.getByText('Brought back a kept copy of the files, and kept a copy of the ones it replaced.')).toBeInTheDocument();
    cleanup();
    render(FilesKeptBlock, { sessionId: SID, reason: 'unfinished', copy: 'c3' });
    expect(screen.getByText("Couldn't finish restoring the files, so some may have changed. Kept a copy of them from just before.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bring them back' })).toBeEnabled();
  });

  it('waits while the agent is working', () => {
    messageStore.setIsRunning(SID, true);
    render(FilesKeptBlock, { sessionId: SID, reason: 'rewind', copy: 'c1' });
    const button = screen.getByRole('button', { name: 'Bring them back' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Waits for the agent to finish its turn');
  });

  it("says why, without Electron's wrapper, when they can't come back", async () => {
    mockGroveBench.bringBackFiles.mockRejectedValueOnce(
      new Error("Error invoking remote method 'agent:bring-back-files': Error: That copy of the files is no longer kept."),
    );
    render(FilesKeptBlock, { sessionId: SID, reason: 'rewind', copy: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^That copy of the files is no longer kept\.$/));
  });
});
