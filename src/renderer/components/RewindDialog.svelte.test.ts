import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/svelte';

import RewindDialog from './RewindDialog.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { GroveBenchAPI } from '../../shared/types.js';

const SID = 'rewind-dialog-session';
const groveBench = () => (window as any).groveBench as { getCheckpointDiff: Mock<GroveBenchAPI['getCheckpointDiff']>; rewindSession: ReturnType<typeof vi.fn> };

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

  it('keeps the preview of the message picked last when an earlier one arrives after it', async () => {
    let finishFirst!: (preview: string) => void;
    groveBench().getCheckpointDiff
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce('preview of the second');
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID);

    await fireEvent.click(await screen.findByText('first prompt'));
    await fireEvent.click(screen.getByText('second prompt'));
    expect(await screen.findByText('preview of the second')).toBeInTheDocument();
    finishFirst('preview of the first');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('preview of the first')).toBeNull();
    expect(screen.getByText('preview of the second')).toBeInTheDocument();
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

  it('says a copy of the files is kept, and that the files stay once Thread only is ticked', async () => {
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID, 'uuid-1');
    await waitFor(() => expect(document.getElementById('conversation-only')).not.toBeNull());
    expect(document.body.textContent).toContain('Files go back to how they were before it: your own changes go too, and new files are removed, but the thread keeps a copy of them as they are now, so you can bring them back.');

    await fireEvent.click(document.getElementById('conversation-only')!);
    await waitFor(() => expect(document.body.textContent).toContain('files stay as they are'));
    expect(document.body.textContent).not.toContain('keeps a copy');
  });

  it('rewinds only the conversation in a folder without git, with no file preview', async () => {
    store.sessions = [{ id: SID, branch: '', repoPath: '/notes', status: 'running', direct: true, noGit: true }] as any;
    groveBench().rewindSession.mockClear();
    render(RewindDialog, { sessionId: SID });
    messageStore.openRewindDialog(SID, 'uuid-1');

    await waitFor(() => expect(document.querySelector('button[aria-pressed="true"]')).not.toBeNull());
    expect(document.body.textContent).toContain('This thread runs without git, so files on disk stay as');
    expect(document.getElementById('conversation-only')).toBeNull();
    expect(groveBench().getCheckpointDiff).not.toHaveBeenCalled();

    const rewindBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Rewind')!;
    rewindBtn.click();
    await waitFor(() => expect(groveBench().rewindSession).toHaveBeenCalledWith(SID, 'uuid-1', { conversationOnly: true }));
  });

  it("says up front when the agent can't forget part of a thread, and only then", async () => {
    store.sessions = [{ id: SID, branch: 'b', repoPath: '/repo', status: 'running', agentType: 'gemini-cli' }] as any;
    agentsStore.list = [{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { rewind: false } }];
    try {
      render(RewindDialog, { sessionId: SID });
      messageStore.openRewindDialog(SID);
      await waitFor(() => expect(screen.getByTestId('rewind-starts-afresh')).toBeInTheDocument());
      expect(screen.getByTestId('rewind-starts-afresh').textContent).toContain("Gemini CLI can't forget part of a thread");
      cleanup();
      agentsStore.list = [{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { rewind: true } }];
      render(RewindDialog, { sessionId: SID });
      messageStore.openRewindDialog(SID);
      await waitFor(() => expect(document.querySelector('button[aria-pressed]')).not.toBeNull());
      expect(screen.queryByTestId('rewind-starts-afresh')).toBeNull();
    } finally {
      agentsStore.list = [];
    }
  });
});
