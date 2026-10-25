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
  messageStore.messagesBySession = {
    [SID]: [
      { kind: 'files_kept', id: 'k1', reason: 'rewind' },
      { kind: 'user', id: 'm1', text: 'Try again', uuid: 'u2' },
      { kind: 'files_kept', id: 'k2', reason: 'bring_back' },
    ],
  };
  messageStore.setIsRunning(SID, false);
});

afterEach(() => {
  cleanup();
  messageStore.setIsRunning(SID, false);
});

describe('FilesKeptBlock', () => {
  it('offers the latest copy back, and brings it back', async () => {
    render(FilesKeptBlock, { sessionId: SID, id: 'k2', reason: 'bring_back' });
    expect(screen.getByText(/Brought back the kept files, and kept a copy of the ones they replaced/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));
    expect(mockGroveBench.bringBackFiles).toHaveBeenCalledWith(SID);
  });

  // Only the latest copy is kept.
  it('offers nothing for a copy a later one replaced', () => {
    render(FilesKeptBlock, { sessionId: SID, id: 'k1', reason: 'rewind' });
    expect(screen.getByText(/Kept a copy of the files from before the rewind/)).toBeInTheDocument();
    expect(screen.getByText('A later copy replaced it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bring them back' })).toBeNull();
  });

  it('waits while the agent is working', () => {
    messageStore.setIsRunning(SID, true);
    render(FilesKeptBlock, { sessionId: SID, id: 'k2', reason: 'bring_back' });
    const button = screen.getByRole('button', { name: 'Bring them back' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Waits for the agent to finish its turn');
  });

  it("says why, without Electron's wrapper, when they can't come back", async () => {
    mockGroveBench.bringBackFiles.mockRejectedValueOnce(
      new Error("Error invoking remote method 'agent:bring-back-files': Error: There are no kept files to bring back."),
    );
    render(FilesKeptBlock, { sessionId: SID, id: 'k2', reason: 'bring_back' });
    await fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^There are no kept files to bring back\.$/));
  });
});
