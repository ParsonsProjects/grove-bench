import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import Sidebar from './Sidebar.svelte';
import { store, projectFromPath } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

beforeEach(() => {
  store.projects = ['/repo-a'].map(projectFromPath);
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
  store.projects = [];
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
    await fireEvent.click(screen.getByTitle('Search conversations (Ctrl+R)'));
    expect(store.finderOpen).toBe(true);
  });
});

describe('Sidebar attention triage', () => {
  beforeEach(() => {
    store.projects = ['/repo-a', '/repo-b'].map(projectFromPath);
    store.sessions = [
      { id: 'working', branch: 'feat-a', repoPath: '/repo-a', status: 'running', displayName: 'Working one' },
      { id: 'blocked', branch: 'feat-b', repoPath: '/repo-a', status: 'running', displayName: 'Blocked one' },
      { id: 'finished', branch: 'feat-c', repoPath: '/repo-b', status: 'running', displayName: 'Finished one' },
      { id: 'quiet', branch: 'feat-d', repoPath: '/repo-b', status: 'running', displayName: 'Quiet one' },
    ] as any;
    store.activeSessionId = 'quiet';
    store.needsAttention = { finished: true };
    messageStore.setIsRunning('working', true);
    messageStore.messagesBySession['blocked'] = [
      { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Write', toolInput: {}, toolUseId: 't1', resolved: false },
    ];
    localStorage.removeItem('grove-bench:sidebar-show-completed');
  });

  afterEach(() => {
    store.needsAttention = {};
    mockGroveBench.setSessionCompleted.mockReset();
    mockGroveBench.setSessionCompleted.mockResolvedValue(undefined);
  });

  it('shows filter chips with mutually exclusive counts', async () => {
    render(Sidebar);

    const group = screen.getByRole('group', { name: 'Filter conversations' });
    expect(group).toHaveTextContent('All 4');
    expect(group).toHaveTextContent('Needs you 1');
    expect(group).toHaveTextContent('Working 1');
    expect(group).toHaveTextContent('Unread 1');
  });

  it('filters the active list by the selected chip', async () => {
    render(Sidebar);

    await fireEvent.click(screen.getByTitle('Needs you: 1'));

    expect(screen.getByText('Blocked one')).toBeInTheDocument();
    expect(screen.queryByText('Working one')).not.toBeInTheDocument();
    expect(screen.queryByText('Quiet one')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTitle('Unread: 1'));
    expect(screen.getByText('Finished one')).toBeInTheDocument();
    expect(screen.queryByText('Blocked one')).not.toBeInTheDocument();
  });

  it('shows per-repo attention counts in the repo header', async () => {
    render(Sidebar);

    expect(screen.getByTitle('1 needs you')).toBeInTheDocument();
    expect(screen.getByTitle('1 working')).toBeInTheDocument();
    expect(screen.getByTitle('1 unread')).toBeInTheDocument();
  });

  it('hides completed sessions until "Show completed" is on, and reopens them from the context menu', async () => {
    store.sessions = store.sessions.map((s) => (s.id === 'quiet' ? { ...s, completedAt: 123 } : s));
    render(Sidebar);

    expect(screen.queryByText('Quiet one')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter conversations' })).toHaveTextContent('All 3');

    await fireEvent.click(screen.getByText('Show completed (1)'));
    expect(screen.getByText('Quiet one')).toBeInTheDocument();

    await fireEvent.contextMenu(screen.getByText('Quiet one'));
    await fireEvent.click(screen.getByText('Reopen'));

    expect(mockGroveBench.setSessionCompleted).toHaveBeenCalledWith('quiet', false);
    expect(store.sessions.find((s) => s.id === 'quiet')?.completedAt).toBeNull();
  });

  it('marks a session completed from the context menu', async () => {
    render(Sidebar);

    await fireEvent.contextMenu(screen.getByText('Working one'));
    await fireEvent.click(screen.getByText('Mark Completed'));

    expect(mockGroveBench.setSessionCompleted).toHaveBeenCalledWith('working', true);
    expect(screen.queryByText('Working one')).not.toBeInTheDocument();
  });
});

describe('Sidebar bottom buttons', () => {
  afterEach(() => {
    mockGroveBench.getSidebarWidth.mockReset();
    mockGroveBench.getSidebarWidth.mockResolvedValue(null);
  });

  it('shows text labels at the default width', async () => {
    render(Sidebar);
    const newConversation = await screen.findByRole('button', { name: 'New conversation' });
    expect(newConversation).toHaveTextContent('+ Conversation');
    expect(screen.getByRole('button', { name: 'Add a project' })).toHaveTextContent('+ Project');
  });

  it('collapses to icons when the sidebar is narrow', async () => {
    mockGroveBench.getSidebarWidth.mockResolvedValue(250);
    render(Sidebar);
    const newConversation = await screen.findByRole('button', { name: 'New conversation' });
    await waitFor(() => expect(newConversation).not.toHaveTextContent('Conversation'));
    expect(newConversation.querySelector('svg')).not.toBeNull();
    const addRepo = screen.getByRole('button', { name: 'Add a project' });
    expect(addRepo).not.toHaveTextContent('Repository');
    expect(addRepo.querySelector('svg')).not.toBeNull();
  });
});

describe('Sidebar project header', () => {
  it('shows the project name rather than the folder name', async () => {
    store.projects = [{ id: 'p1', name: 'Grove Bench', workspaces: [{ id: 'w1', path: '/repo-a', kind: 'git' }], createdAt: 1 }];
    render(Sidebar);
    expect(await screen.findByTitle('/repo-a')).toHaveTextContent('Grove Bench');
  });

  it('renames a project from the header context menu', async () => {
    store.projects = [{ id: 'p1', name: 'repo-a', workspaces: [{ id: 'w1', path: '/repo-a', kind: 'git' }], createdAt: 1 }];
    mockGroveBench.renameProject.mockResolvedValueOnce({ id: 'p1', name: 'Grove Bench', workspaces: [{ id: 'w1', path: '/repo-a', kind: 'git' }], createdAt: 1 });
    render(Sidebar);

    await fireEvent.contextMenu(await screen.findByTitle('/repo-a'));
    await fireEvent.click(await screen.findByText('Rename Project'));

    const input = await screen.findByLabelText('Project name');
    expect(input).toHaveValue('repo-a');
    await fireEvent.input(input, { target: { value: 'Grove Bench' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(mockGroveBench.renameProject).toHaveBeenCalledWith('p1', 'Grove Bench'));
    await waitFor(() => expect(screen.getByTitle('/repo-a')).toHaveTextContent('Grove Bench'));
  });

  it('disables Remove Project in the menu while the project has conversations', async () => {
    store.projects = [{ id: 'p1', name: 'repo-a', workspaces: [{ id: 'w1', path: '/repo-a', kind: 'git' }], createdAt: 1 }];
    render(Sidebar);

    await fireEvent.contextMenu(await screen.findByTitle('/repo-a'));
    const remove = await screen.findByRole('button', { name: 'Remove Project' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', 'Destroy all conversations first');
  });

  it('removes a project by id once confirmed', async () => {
    store.projects = [{ id: 'p1', name: 'repo-a', workspaces: [{ id: 'w1', path: '/repo-a', kind: 'git' }], createdAt: 1 }];
    store.sessions = [];
    render(Sidebar);

    await fireEvent.click(await screen.findByTitle('Remove project'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mockGroveBench.removeProject).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(store.projects).toEqual([]));
  });
});
