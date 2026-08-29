import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import Sidebar from './Sidebar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

beforeEach(() => {
  store.repos = ['/repo-a'];
  store.sessions = [
    { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Sidebar revamp' },
  ] as any;
  store.activeSessionId = 's1';
  store.finderOpen = false;
  sessionPreviewStore.previews = {};
  mockGroveBench.getSessionPreviews.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockGroveBench.getSessionPreviews.mockReset();
  mockGroveBench.getCollapsedRepos.mockReset();
  mockGroveBench.getCollapsedRepos.mockResolvedValue({});
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.finderOpen = false;
  messageStore.messagesBySession = {};
  messageStore.isRunning = {};
  messageStore.activityBySession = {};
});

describe('Sidebar session rows', () => {
  it('shows the running tool as the row subtitle while the agent works', async () => {
    messageStore.setIsRunning('s1', true);
    messageStore.activityBySession['s1'] = {
      activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test',
    };
    render(Sidebar);
    expect(await screen.findByText('Bash: npm test')).toBeInTheDocument();
  });

  it('shows the last conversation text when the agent is idle', async () => {
    messageStore.messagesBySession['s1'] = [
      { kind: 'user', id: 'u1', text: 'improve the sidebar' },
      { kind: 'text', id: 'a1', text: 'Sidebar rows now show context', uuid: '' },
    ];
    render(Sidebar);
    expect(await screen.findByText('Sidebar rows now show context')).toBeInTheDocument();
  });

  it('shows a waiting subtitle when a permission is pending', async () => {
    messageStore.messagesBySession['s1'] = [
      { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Write', toolInput: {}, toolUseId: 't1', resolved: false },
    ];
    render(Sidebar);
    expect(await screen.findByText('Waiting for approval — Write')).toBeInTheDocument();
  });

  it('uses the main-process preview for sessions with no loaded messages', async () => {
    store.sessions = [
      { id: 's2', branch: 'fix-parser', repoPath: '/repo-a', status: 'stopped' },
    ] as any;
    mockGroveBench.getSessionPreviews.mockResolvedValue({
      s2: { firstPrompt: 'fix the parser bug', lastText: 'parser fixed' },
    });
    // Stopped sessions live in the inactive tree, which is collapsed by default.
    mockGroveBench.getCollapsedRepos.mockResolvedValue({ '/repo-a': false });
    render(Sidebar);
    expect(await screen.findByText('parser fixed')).toBeInTheDocument();
    expect(mockGroveBench.getSessionPreviews).toHaveBeenCalledWith(['s2']);
  });

  it('opens the session finder from the search field', async () => {
    render(Sidebar);
    await fireEvent.click(screen.getByTitle('Search sessions and conversations (Ctrl+R)'));
    expect(store.finderOpen).toBe(true);
  });
});
