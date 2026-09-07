import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import SessionFinder from './SessionFinder.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { CrossSessionSearchHit } from '../../shared/types.js';

const HITS: CrossSessionSearchHit[] = [
  { sessionId: 's2', eventIndex: 12, kind: 'assistant', snippet: 'fixed the parser edge case' },
];

beforeEach(() => {
  store.sessions = [
    { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Sidebar revamp' },
    { id: 's2', branch: 'fix-parser', repoPath: '/repo-a', status: 'stopped' },
  ] as any;
  store.activeSessionId = 's1';
  sessionPreviewStore.previews = {};
  mockGroveBench.searchAllEventHistory.mockResolvedValue(HITS);
  mockGroveBench.getSessionPreviews.mockResolvedValue({
    s2: { firstPrompt: 'fix the parser bug', lastText: 'done' },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockGroveBench.searchAllEventHistory.mockReset();
  mockGroveBench.getSessionPreviews.mockReset();
  store.sessions = [];
  store.activeSessionId = null;
});

async function typeQuery(text: string) {
  const input = screen.getByPlaceholderText('Search sessions and conversations...');
  await fireEvent.input(input, { target: { value: text } });
  // Debounce (250ms) then the resolved promise
  await new Promise((r) => setTimeout(r, 300));
}

describe('SessionFinder', () => {
  it('lists sessions with display names and preview prompts', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Sidebar revamp')).toBeInTheDocument();
    expect(screen.getByText('fix-parser')).toBeInTheDocument();
    // Preview-derived first prompt for the stopped session (no loaded messages)
    expect(await screen.findByText('fix the parser bug')).toBeInTheDocument();
  });

  it('searches conversations across sessions and shows snippets', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('parser');

    expect(mockGroveBench.searchAllEventHistory).toHaveBeenCalledWith(['s1', 's2'], 'parser', 3);
    expect(screen.getByText('In conversations')).toBeInTheDocument();
    // Snippet is split into highlight segments; match on the mark element
    expect(screen.getByText('parser', { selector: 'mark' })).toBeInTheDocument();
  });

  it('selecting a conversation hit focuses the session and requests a jump', async () => {
    const requestSpy = vi.spyOn(messageStore, 'requestJump');
    const onclose = vi.fn();
    render(SessionFinder, { onclose });
    await typeQuery('parser');

    await fireEvent.mouseDown(screen.getByText('parser', { selector: 'mark' }));

    expect(store.activeSessionId).toBe('s2');
    expect(requestSpy).toHaveBeenCalledWith('s2', { eventIndex: 12, uuid: null, bookmarkId: '' });
    expect(onclose).toHaveBeenCalledWith('s2');
  });

  it('does not run a content search for queries under 2 characters', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('p');
    expect(mockGroveBench.searchAllEventHistory).not.toHaveBeenCalled();
  });
});
