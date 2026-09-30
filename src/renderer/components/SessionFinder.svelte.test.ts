import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import SessionFinder from './SessionFinder.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import { AGENT_SPRITES } from '../lib/agent-sprite.js';
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
  const input = screen.getByPlaceholderText('Search conversations and messages...');
  await fireEvent.input(input, { target: { value: text } });
  // Debounce (150ms) then the resolved promise
  await new Promise((r) => setTimeout(r, 300));
}

/** The highlighted match inside the message hit's snippet. */
function snippetMark(text: string): HTMLElement {
  const hit = screen.getByText('fixed the', { exact: false, selector: 'span' });
  const mark = [...hit.querySelectorAll('mark')].find((m) => m.textContent === text);
  if (!mark) throw new Error(`no <mark>${text}</mark> in snippet`);
  return mark;
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

  it('shows the same status dot as the sidebar', async () => {
    store.sessions = [
      { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'starting', displayName: 'Booting' },
      { id: 's2', branch: 'fix-parser', repoPath: '/repo-a', status: 'running', displayName: 'Idle one' },
    ] as any;
    render(SessionFinder, { onclose: vi.fn() });
    expect(screen.getByRole('img', { name: 'Starting' })).toHaveClass(AGENT_SPRITES.starting.colorClass);
    expect(screen.getByRole('img', { name: 'Ready' })).toHaveClass(AGENT_SPRITES.ready.colorClass);
  });

  it('shows a loaded first prompt as plain text, like the preview of an unloaded one', async () => {
    messageStore.messagesBySession = { s1: [{ kind: 'user', id: 'u1', text: '## Plan\n- fix **the** parser' }] } as any;
    try {
      render(SessionFinder, { onclose: vi.fn() });
      expect(screen.getByText('Plan fix the parser')).toBeInTheDocument();
    } finally {
      messageStore.messagesBySession = {};
    }
  });

  it('searches conversations across sessions and shows snippets', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('parser');

    expect(mockGroveBench.searchAllEventHistory).toHaveBeenCalledWith(['s1', 's2'], 'parser', 3, 30);
    expect(screen.getByText('In messages')).toBeInTheDocument();
    // Snippet is split into highlight segments; match on the mark element
    expect(snippetMark('parser')).toBeInTheDocument();
  });

  it('searches message content newest conversation first', async () => {
    store.sessions = [
      { id: 'old', branch: 'a', repoPath: '/repo-a', status: 'stopped', lastActiveAt: 1_000 },
      { id: 'new', branch: 'b', repoPath: '/repo-a', status: 'stopped', lastActiveAt: 3_000 },
      { id: 'mid', branch: 'c', repoPath: '/repo-a', status: 'stopped', createdAt: 2_000 },
    ] as any;
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('parser');
    expect(mockGroveBench.searchAllEventHistory).toHaveBeenCalledWith(['new', 'mid', 'old'], 'parser', 3, 30);
  });

  it('does not re-run the content search when a session status changes', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('parser');
    expect(mockGroveBench.searchAllEventHistory).toHaveBeenCalledTimes(1);
    store.updateStatus('s1', 'error');
    await new Promise((r) => setTimeout(r, 300));
    expect(mockGroveBench.searchAllEventHistory).toHaveBeenCalledTimes(1);
  });

  it('highlights query words in conversation rows', async () => {
    render(SessionFinder, { onclose: vi.fn() });
    await typeQuery('revamp');
    expect(screen.getByText('revamp', { selector: 'mark' })).toBeInTheDocument();
  });

  it('matches words late in the first prompt', async () => {
    mockGroveBench.getSessionPreviews.mockResolvedValue({
      s2: { firstPrompt: 'Please look at the sidebar component and then refactor the websocket reconnect logic', lastText: '' },
    });
    render(SessionFinder, { onclose: vi.fn() });
    await screen.findByText('sidebar', { exact: false });
    await typeQuery('websocket');
    expect(screen.getByText('websocket', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.queryByText('Sidebar revamp')).not.toBeInTheDocument();
  });

  it('selecting a conversation hit focuses the session and requests a jump', async () => {
    const requestSpy = vi.spyOn(messageStore, 'requestJump');
    const onclose = vi.fn();
    render(SessionFinder, { onclose });
    await typeQuery('parser');

    await fireEvent.mouseDown(snippetMark('parser'));

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
