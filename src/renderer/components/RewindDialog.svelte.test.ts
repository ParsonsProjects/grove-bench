import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';

import RewindDialog from './RewindDialog.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const SID = 'rewind-dialog-session';
const groveBench = () => (window as any).groveBench as { getCheckpointDiff: ReturnType<typeof vi.fn>; rewindSession: ReturnType<typeof vi.fn> };

beforeEach(() => {
  messageStore.messagesBySession = {
    [SID]: [
      { kind: 'user', id: 'u1', text: 'first prompt', uuid: 'uuid-1' },
      { kind: 'user', id: 'u2', text: 'second prompt', uuid: 'uuid-2' },
    ],
  };
  messageStore.closeRewindDialog(SID);
  groveBench().getCheckpointDiff.mockClear();
  groveBench().getCheckpointDiff.mockResolvedValue('diff --git a/x b/x');
});

afterEach(() => {
  messageStore.closeRewindDialog(SID);
  cleanup();
  store.sessions = [];
});

describe('RewindDialog', () => {
  it('opens preselected on the message it was launched from and loads its preview', async () => {
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID, 'uuid-1');

    await waitFor(() => {
      expect(groveBench().getCheckpointDiff).toHaveBeenCalledWith(SID, 'uuid-1');
    });
    const selected = document.querySelector('button[aria-pressed="true"]');
    expect(selected).not.toBeNull();
    expect(selected!.textContent).toContain('first prompt');
    // The confirm button is enabled straight away
    const rewindBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Rewind');
    expect(rewindBtn).toBeDefined();
    expect(rewindBtn!).not.toBeDisabled();
  });

  it('opens with nothing selected when launched without a target (/rewind)', async () => {
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID);

    await waitFor(() => {
      expect(document.querySelector('button[aria-pressed="false"]')).not.toBeNull();
    });
    expect(document.querySelector('button[aria-pressed="true"]')).toBeNull();
    expect(groveBench().getCheckpointDiff).not.toHaveBeenCalled();
  });

  it('rewinds only the conversation in a folder without git, with no file preview', async () => {
    store.sessions = [{ id: SID, branch: '', repoPath: '/notes', status: 'running', direct: true, noGit: true }] as any;
    groveBench().rewindSession.mockClear();
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID, 'uuid-1');

    await waitFor(() => expect(document.querySelector('button[aria-pressed="true"]')).not.toBeNull());
    expect(document.body.textContent).toContain("This project isn't a git repository, so files on disk stay as");
    expect(document.getElementById('conversation-only')).toBeNull();
    expect(groveBench().getCheckpointDiff).not.toHaveBeenCalled();

    const rewindBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Rewind')!;
    rewindBtn.click();
    await waitFor(() => expect(groveBench().rewindSession).toHaveBeenCalledWith(SID, 'uuid-1', { conversationOnly: true }));
  });
});
