import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

// MarkdownBlock (pulled in transitively) calls DOMPurify.addHook at module load.
// DOMPurify's default export resolves to a factory in this test environment, so
// stub it — these tests render no markdown (empty message list).
vi.mock('dompurify', () => ({
  default: { addHook: () => {}, sanitize: (html: string) => html },
}));

import OutputPanel from './OutputPanel.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const SID = 'panel-session';

beforeEach(() => {
  messageStore.messagesBySession = { [SID]: [] };
  messageStore.paginationBySession = {};
  store.sessions = [];
});

afterEach(() => cleanup());

async function pressCtrlF() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  await tick();
}

describe('OutputPanel — rewind from a user message', () => {
  it('offers Rewind on user messages that have a checkpoint and opens the dialog on that message', async () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'user', id: 'u1', text: 'first prompt', uuid: 'uuid-1' },
        { kind: 'text', id: 't1', text: 'reply', uuid: 'a1' },
        { kind: 'user', id: 'u2', text: 'second prompt', uuid: 'uuid-2' },
      ],
    };
    const openSpy = vi.spyOn(messageStore, 'openRewindDialog');
    const { getAllByRole } = render(OutputPanel, { sessionId: SID });

    const buttons = getAllByRole('button', { name: 'Rewind to this message' });
    expect(buttons).toHaveLength(2);

    buttons[1].click();
    expect(openSpy).toHaveBeenCalledWith(SID, 'uuid-2');
    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
    expect(messageStore.getRewindDialogTarget(SID)).toBe('uuid-2');
    openSpy.mockRestore();
    messageStore.closeRewindDialog(SID);
  });

  it('does not offer Rewind on a user message without a checkpoint', () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'user', id: 'u1', text: 'no checkpoint yet' }],
    };
    const { queryByRole } = render(OutputPanel, { sessionId: SID });
    expect(queryByRole('button', { name: 'Rewind to this message' })).toBeNull();
  });
});

describe('OutputPanel — Ctrl+F search gating (fix C)', () => {
  it('opens search when this pane is the active session', async () => {
    store.activeSessionId = SID;
    const { queryByPlaceholderText } = render(OutputPanel, { sessionId: SID });

    expect(queryByPlaceholderText('Search full history...')).toBeNull();
    await pressCtrlF();
    expect(queryByPlaceholderText('Search full history...')).toBeInTheDocument();
  });

  it('ignores Ctrl+F when a different session is active', async () => {
    // This pane is mounted (hidden) but another session is active.
    store.activeSessionId = 'some-other-session';
    const { queryByPlaceholderText } = render(OutputPanel, { sessionId: SID });

    await pressCtrlF();
    expect(queryByPlaceholderText('Search full history...')).toBeNull();
  });
});
