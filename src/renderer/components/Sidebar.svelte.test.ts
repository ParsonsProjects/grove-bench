import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

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
    await fireEvent.click(screen.getByTitle('Search conversations (Ctrl+R)'));
    expect(store.finderOpen).toBe(true);
  });
});

describe('Sidebar attention triage', () => {
  beforeEach(() => {
    store.repos = ['/repo-a', '/repo-b'];
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

describe('Sidebar clean-up dialog', () => {
  const DAY = 86_400_000;
  const longAgo = Date.now() - 30 * DAY;

  beforeEach(() => {
    store.repos = ['/repo-a'];
    store.sessions = [
      { id: 'live', branch: 'feat-live', repoPath: '/repo-a', status: 'running', displayName: 'Live one' },
      { id: 'merged', branch: 'feat-merged', repoPath: '/repo-a', status: 'stopped', displayName: 'Merged one', lastActiveAt: longAgo },
      { id: 'open', branch: 'feat-open', repoPath: '/repo-a', status: 'stopped', displayName: 'Open one', lastActiveAt: longAgo },
      { id: 'nopr', branch: 'feat-nopr', repoPath: '/repo-a', status: 'stopped', displayName: 'No PR one', lastActiveAt: longAgo },
    ] as any;
    store.activeSessionId = 'live';
    store.prerequisites = { git: { available: true }, agent: { available: true }, gh: { available: true } } as any;
    mockGroveBench.getPrs.mockImplementation(async (id: string) => {
      // Primary first, as main sorts them: an older merged PR behind the open one.
      if (id === 'merged') return [{ number: 12, url: 'https://example.test/pr/12', state: 'MERGED', title: 'Merged work' }] as any;
      if (id === 'open') return [
        { number: 13, url: 'https://example.test/pr/13', state: 'OPEN' },
        { number: 9, url: 'https://example.test/pr/9', state: 'MERGED' },
      ] as any;
      return [];
    });
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    store.prerequisites = null;
    mockGroveBench.getPrs.mockReset();
    mockGroveBench.getPrs.mockResolvedValue([]);
    mockGroveBench.getGitStatus.mockReset();
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
  });

  async function openDialog() {
    render(Sidebar);
    await fireEvent.click(screen.getByTitle('Clean up old conversations'));
    return await screen.findByRole('dialog');
  }

  it('flags each stopped candidate with the state of its primary pull request', async () => {
    await openDialog();

    expect(await screen.findByTestId('cleanup-pr-merged')).toHaveTextContent('PR #12 merged');
    expect(await screen.findByTestId('cleanup-pr-open')).toHaveTextContent('PR #13 open');
    expect(await screen.findByTestId('cleanup-pr-nopr')).toHaveTextContent('no PR');
    // Running sessions are not candidates, so no gh call is spent on them.
    expect(mockGroveBench.getPrs).not.toHaveBeenCalledWith('live');
  });

  it('"Select merged" ticks only conversations whose PR has been merged', async () => {
    await openDialog();
    // Preselection ticks everything that is clean.
    await waitFor(() => expect(screen.getByLabelText(/Open one/)).toBeChecked());

    await fireEvent.click(await screen.findByRole('button', { name: 'Select merged (1)' }));

    expect(screen.getByLabelText(/Merged one/)).toBeChecked();
    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();
    expect(screen.getByLabelText(/No PR one/)).not.toBeChecked();
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
  });

  it('leaves a merged conversation with uncommitted changes unticked, even via "Select merged"', async () => {
    mockGroveBench.getGitStatus.mockImplementation((async (id: string) => ({
      entries: id === 'merged' ? [{ filePath: 'a.ts', status: 'M', staged: false }] : [],
    })) as any);
    await openDialog();

    await screen.findByText('· uncommitted changes');
    expect(screen.getByLabelText(/Merged one/)).not.toBeChecked();

    // The merged count still shows it, but selecting keeps the dirty rule.
    await fireEvent.click(await screen.findByRole('button', { name: 'Select merged (1)' }));
    expect(screen.getByLabelText(/Merged one/)).not.toBeChecked();
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });

  it('keeps the user\'s ticks and does not re-check when an unrelated session changes', async () => {
    await openDialog();
    await screen.findByTestId('cleanup-pr-nopr');
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3));

    await fireEvent.click(screen.getByLabelText(/Open one/));
    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();

    // A status change on a running session rebuilds store.sessions but not the candidate set.
    store.updateStatus('live', 'error');
    await tick();

    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();
    expect(screen.getByLabelText(/Merged one/)).toBeChecked();
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3);
    expect(mockGroveBench.getPrs).toHaveBeenCalledTimes(3);
  });

  it('checks only the newly listed conversations when the cutoff changes', async () => {
    store.sessions = [
      ...store.sessions,
      { id: 'recent', branch: 'feat-recent', repoPath: '/repo-a', status: 'stopped', displayName: 'Recent one', lastActiveAt: Date.now() - 10 * DAY },
    ] as any;
    await openDialog();
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3));
    expect(screen.queryByLabelText(/Recent one/)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText(/Open one/));

    await fireEvent.click(screen.getByRole('button', { name: '7' }));

    // The new candidate is checked and preselected; the earlier untick survives.
    await waitFor(() => expect(screen.getByLabelText(/Recent one/)).toBeChecked());
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(4);
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('recent');
    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();
  });

  it('does not run a git status check for direct conversations', async () => {
    store.sessions = [
      ...store.sessions,
      { id: 'direct', branch: 'main', repoPath: '/repo-a', status: 'stopped', direct: true, displayName: 'Direct one', lastActiveAt: longAgo },
    ] as any;
    await openDialog();

    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3));
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalledWith('direct');
    await waitFor(() => expect(screen.getByLabelText(/Direct one/)).toBeChecked());
  });

  it('skips PR lookups when the GitHub CLI is unavailable', async () => {
    store.prerequisites = { ...store.prerequisites, gh: { available: false } } as any;
    await openDialog();

    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3));
    expect(mockGroveBench.getPrs).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Select merged/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-pr-merged')).not.toBeInTheDocument();
  });

  it('shows "PR unknown" when gh cannot answer for a branch', async () => {
    mockGroveBench.getPrs.mockRejectedValue(new Error('gh: offline'));
    await openDialog();

    expect(await screen.findByTestId('cleanup-pr-merged')).toHaveTextContent('PR unknown');
    expect(screen.queryByRole('button', { name: /Select merged/ })).toBeDisabled();
  });
});
