import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';

import Sidebar from './Sidebar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { prStore } from '../stores/pr.svelte.js';
import { panelStore } from '../stores/panels.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import { DEFAULT_REPO_COLORS } from '../lib/repo-colors.js';
import { AGENT_SPRITES } from '../lib/agent-sprite.js';

beforeEach(() => {
  // Call counts start from zero in every test, whatever ran before it.
  vi.clearAllMocks();
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
  settingsStore.panelOpen = false;
  vi.restoreAllMocks();
  mockGroveBench.getSessionPreviews.mockReset();
  mockGroveBench.getCollapsedRepos.mockReset();
  mockGroveBench.getCollapsedRepos.mockResolvedValue({});
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.finderOpen = false;
  store.showCompleted = false;
  store.sessionSort = { key: 'name', dir: 'asc' };
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
    expect(await screen.findByText('Wants to edit a file')).toBeInTheDocument();
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

  it('shows a character by default and the plain dot when grove characters are off', async () => {
    messageStore.messagesBySession['s1'] = [
      { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Write', toolInput: {}, toolUseId: 't1', resolved: false },
    ];
    render(Sidebar);
    expect((await screen.findByRole('img', { name: 'Waiting for you' })).tagName).toBe('svg');

    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    try {
      // The dot says the same thing, in the character's colour.
      await waitFor(() => expect(screen.getByRole('img', { name: 'Waiting for you' }).tagName).toBe('SPAN'));
      expect(screen.getByRole('img', { name: 'Waiting for you' })).toHaveClass(AGENT_SPRITES.permission.colorClass, 'bg-current');
    } finally {
      settingsStore.current = { ...settingsStore.current, groveCharacters: true };
    }
  });

  it('only moves the plain dot when the system allows motion', async () => {
    store.sessions = [
      { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Working one' },
      { id: 's2', branch: 'feat-y', repoPath: '/repo-a', status: 'running', displayName: 'Finished one' },
    ] as any;
    store.needsAttention = { s2: true };
    messageStore.setIsRunning('s1', true);
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    try {
      render(Sidebar);
      const working = screen.getByRole('img', { name: 'Working' });
      expect(working).toHaveClass('motion-safe:animate-pulse');
      expect(working).not.toHaveClass('animate-pulse');
      // Its flash is defined under prefers-reduced-motion: no-preference.
      expect(screen.getByRole('img', { name: 'Finished a turn' })).toHaveClass('needs-attention-flash');
    } finally {
      store.needsAttention = {};
      settingsStore.current = { ...settingsStore.current, groveCharacters: true };
    }
  });

  it('draws stopped and sleeping dots hollow, like the character asleep', async () => {
    store.sessions = [{ id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'sleeping', displayName: 'Asleep' }] as any;
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    try {
      render(Sidebar);
      const dot = screen.getByRole('img', { name: 'Sleeping' });
      expect(dot).toHaveClass('border-current');
      expect(dot).not.toHaveClass('bg-current');
    } finally {
      settingsStore.current = { ...settingsStore.current, groveCharacters: true };
    }
  });

  it('gives the name the first line and puts the project on the second', async () => {
    store.repos = ['/repo-a', '/repo-b'];
    messageStore.setIsRunning('s1', true);
    messageStore.activityBySession['s1'] = { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' };
    const { container } = render(Sidebar);
    const [line1, line2] = container.querySelector('.group\\/session > button')!.children;
    expect(line1).toHaveTextContent('Sidebar revamp');
    expect(line1).not.toHaveTextContent('repo-a');
    expect(line2).toHaveTextContent('repo-a · Bash: npm test');
  });

  it('leaves the project out of the row when there is only one', async () => {
    const { container } = render(Sidebar);
    expect(container.querySelector('.group\\/session')).not.toHaveTextContent('repo-a');
  });

  it('keeps the quick action outside the row button', async () => {
    render(Sidebar);
    const stop = screen.getByTitle('Stop agent');
    expect(stop.tagName).toBe('BUTTON');
    expect(stop.parentElement!.closest('button')).toBeNull();
    expect(stop).toHaveAccessibleName('Stop agent in Sidebar revamp');
  });

  it('swaps the age for the quick action on keyboard focus anywhere in the row', async () => {
    store.sessions = [{ id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Sidebar revamp', createdAt: Date.now() }] as any;
    render(Sidebar);
    const focusRule = 'group-has-[:focus-visible]/session';
    expect(screen.getByTitle('Stop agent')).toHaveClass(`${focusRule}:opacity-100`);
    expect(screen.getByTitle(/^Created /)).toHaveClass(`${focusRule}:invisible`);
  });

  it('has no menu item that starts a second agent in the same worktree', async () => {
    render(Sidebar);
    await fireEvent.contextMenu(screen.getByText('Sidebar revamp'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByText('New Conversation')).toBeNull();
  });

  it('shows the project colour on the laptop instead of a square when grove characters are on', async () => {
    store.repos = ['/repo-a', '/repo-b'];
    const { container } = render(Sidebar);
    const row = () => container.querySelector('.group\\/session')!;
    const square = () => row().querySelector('span[style*="background-color"]');
    const logoFills = () => [...row().querySelectorAll('svg.agent-sprite rect')].map((r) => r.getAttribute('fill'));

    await waitFor(() => expect(logoFills()).toContain(DEFAULT_REPO_COLORS[0]));
    expect(square()).toBeNull();

    // Follows a colour picked in settings.
    settingsStore.current = { ...settingsStore.current, repoColors: { '/repo-a': '#123456' } };
    try {
      await waitFor(() => expect(logoFills()).toContain('#123456'));

      settingsStore.current = { ...settingsStore.current, groveCharacters: false };
      await waitFor(() => expect(square()).not.toBeNull());
    } finally {
      settingsStore.current = { ...settingsStore.current, groveCharacters: true, repoColors: {} };
    }
  });

  it('goes back to the landing screen when the open conversation is stopped', async () => {
    store.sessions = [
      { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Sidebar revamp' },
      { id: 's2', branch: 'feat-y', repoPath: '/repo-a', status: 'running', displayName: 'Other one' },
    ] as any;
    const { closeSession } = mockGroveBench;
    render(Sidebar);
    const row = (await screen.findAllByText('Sidebar revamp'))
      .map((el) => el.closest('.group\\/session'))
      .find((el) => el?.querySelector('[title="Stop agent"]'))!;
    await fireEvent.click(row.querySelector('[title="Stop agent"]')!);

    expect(closeSession).toHaveBeenCalledWith('s1');
    // Not the other running conversation.
    expect(store.activeSessionId).toBeNull();
  });

  it('colours the branch icon by the PR health shown in the status bar', async () => {
    const icon = () => screen.getByRole('img', { name: /^Worktree/ });
    render(Sidebar);
    expect(icon()).toHaveAttribute('data-pr-health', 'none');
    expect(icon()).toHaveClass('text-muted-foreground');

    prStore.prsBySession = { s1: [{ number: 12, url: 'u', state: 'OPEN', checks: { total: 2, passed: 1, failed: 1, pending: 0 } }] };
    try {
      await waitFor(() => expect(icon()).toHaveAttribute('data-pr-health', 'failing'));
      expect(icon()).toHaveClass('text-red-500');
      expect(icon()).toHaveAccessibleName('Worktree, PR #12: CI failing');
      // The app's tooltip layer reads title attributes, so hovering the icon explains the colour.
      expect(icon()).toHaveAttribute('title', 'Worktree, PR #12: CI failing');
    } finally {
      prStore.clear('s1');
    }
  });

  it('keeps the branch icon neutral for stopped conversations, whose PR data is not polled', async () => {
    store.sessions = [
      { id: 's2', branch: 'fix-parser', repoPath: '/repo-a', status: 'stopped' },
    ] as any;
    mockGroveBench.getCollapsedRepos.mockResolvedValue({ '/repo-a': false });
    prStore.prsBySession = { s2: [{ number: 3, url: 'u', state: 'MERGED' }] };
    try {
      render(Sidebar);
      const icon = await screen.findByRole('img', { name: 'Worktree' });
      expect(icon).toHaveAttribute('data-pr-health', 'none');
    } finally {
      prStore.clear('s2');
    }
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
    expect(group).not.toHaveTextContent('All');
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

    // Clicking the active chip again shows everything.
    await fireEvent.click(screen.getByRole('button', { name: 'Unread 1', pressed: true }));
    expect(screen.getByText('Blocked one')).toBeInTheDocument();
    expect(screen.getByText('Quiet one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('counts a conversation that is starting up as working, matching its colour', async () => {
    store.sessions = [...store.sessions, { id: 'booting', branch: 'feat-e', repoPath: '/repo-b', status: 'starting', displayName: 'Booting one' }] as any;
    render(Sidebar);
    expect(screen.getByRole('group', { name: 'Filter conversations' })).toHaveTextContent('Working 2');
    expect(screen.getByRole('img', { name: 'Starting' })).toHaveClass(AGENT_SPRITES.working.colorClass);
  });

  it('counts an errored conversation under no chip, even when it is also unread', async () => {
    store.sessions = [...store.sessions, { id: 'broken', branch: 'feat-e', repoPath: '/repo-b', status: 'error', displayName: 'Broken one' }] as any;
    store.needsAttention = { finished: true, broken: true };
    render(Sidebar);
    // Red, not green: it isn't counted as unread.
    expect(screen.getByRole('img', { name: 'Error' })).toHaveClass(AGENT_SPRITES.error.colorClass);
    expect(screen.getByRole('group', { name: 'Filter conversations' })).toHaveTextContent('Unread 1');
  });

  it('shows only dots and counts on the chips when the sidebar is narrow', async () => {
    mockGroveBench.getSidebarWidth.mockResolvedValue(250);
    try {
      render(Sidebar);
      const chip = screen.getByRole('button', { name: 'Needs you 1' });
      await waitFor(() => expect(chip).not.toHaveTextContent('Needs you'));
      expect(chip).toHaveTextContent('1');
      expect(chip).toHaveAttribute('title', 'Needs you: 1');
    } finally {
      mockGroveBench.getSidebarWidth.mockReset();
      mockGroveBench.getSidebarWidth.mockResolvedValue(null);
    }
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

describe('Sidebar settings', () => {
  it('loads the Settings panel when first opened', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(Sidebar);
    expect(screen.queryByRole('dialog')).toBeNull();

    await fireEvent.click(screen.getByTitle('Settings (Ctrl+,)'));

    // The panel's code loads on first open, which can be slow under test.
    expect(await screen.findByRole('dialog', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('Sidebar rename', () => {
  it('shows a saved name even if the dialog closed before the save returned', async () => {
    let finish!: () => void;
    mockGroveBench.renameSession.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    render(Sidebar);
    await fireEvent.contextMenu(await screen.findByText('Sidebar revamp'));
    await fireEvent.click(await screen.findByText('Rename'));
    const input = await screen.findByDisplayValue('Sidebar revamp');
    await fireEvent.input(input, { target: { value: 'Faster sidebar' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    finish();

    expect(await screen.findByText('Faster sidebar')).toBeInTheDocument();
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

  it('keeps PR lookups to 3 at a time across cutoff edits, and stops them on close', async () => {
    const old = (n: number) => ({ id: `old${n}`, branch: `b-old${n}`, repoPath: '/repo-a', status: 'stopped', displayName: `Old ${n}`, lastActiveAt: longAgo });
    const recent = (n: number) => ({ id: `new${n}`, branch: `b-new${n}`, repoPath: '/repo-a', status: 'stopped', displayName: `New ${n}`, lastActiveAt: Date.now() - 10 * DAY });
    store.sessions = [old(1), old(2), old(3), old(4), recent(1), recent(2), recent(3)] as any;
    const pending: Array<() => void> = [];
    mockGroveBench.getPrs.mockImplementation((() => new Promise((res) => { pending.push(() => res([])); })) as any);

    await openDialog();
    await waitFor(() => expect(mockGroveBench.getPrs).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: '7' }));
    await waitFor(() => expect(screen.getByLabelText(/New 3/)).toBeInTheDocument());
    await tick();
    // None has finished, so every call so far is still running.
    expect(mockGroveBench.getPrs.mock.calls.length).toBeLessThanOrEqual(3);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const before = mockGroveBench.getPrs.mock.calls.length;
    for (const finish of pending.splice(0)) finish();
    await tick();
    await tick();
    expect(mockGroveBench.getPrs).toHaveBeenCalledTimes(before);
  });

  it('runs at most 3 git status checks at once, and none left waiting after close', async () => {
    const old = (n: number) => ({ id: `old${n}`, branch: `b-old${n}`, repoPath: '/repo-a', status: 'stopped', displayName: `Old ${n}`, lastActiveAt: longAgo });
    store.sessions = [old(1), old(2), old(3), old(4), old(5)] as any;
    const pending: Array<() => void> = [];
    mockGroveBench.getGitStatus.mockImplementation((() => new Promise((res) => { pending.push(() => res({ entries: [] })); })) as any);

    await openDialog();
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(3));
    pending.shift()!();
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(4));

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    for (const finish of pending.splice(0)) finish();
    await tick();
    await tick();
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(4);
  });

  it('does not tick a conversation until its status check comes back clean', async () => {
    let finish!: (v: unknown) => void;
    mockGroveBench.getGitStatus.mockImplementation((async (id: string) =>
      id === 'open' ? new Promise((r) => { finish = r; }) : { entries: [] }) as any);
    await openDialog();
    await waitFor(() => expect(screen.getByLabelText(/Merged one/)).toBeChecked());

    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();

    finish({ entries: [] });
    await waitFor(() => expect(screen.getByLabelText(/Open one/)).toBeChecked());
  });

  it('leaves one whose status git could not read unticked, and says so', async () => {
    mockGroveBench.getGitStatus.mockImplementation((async (id: string) =>
      id === 'nopr' ? { entries: [], error: 'fatal: index file corrupt' } : { entries: [] }) as any);
    await openDialog();
    await screen.findByText('· changes unknown');

    expect(screen.getByLabelText(/No PR one/)).not.toBeChecked();
    expect(screen.getByLabelText(/Open one/)).toBeChecked();
  });

  it('lists nothing while the day field is empty', async () => {
    await openDialog();
    await waitFor(() => expect(screen.getByLabelText(/Open one/)).toBeInTheDocument());
    const days = screen.getByRole('spinbutton');
    await fireEvent.input(days, { target: { value: '' } });
    await waitFor(() => expect(screen.queryByLabelText(/Open one/)).not.toBeInTheDocument());
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

  it('says how many "Select all" leaves out for uncommitted changes', async () => {
    mockGroveBench.getGitStatus.mockImplementation((async (id: string) => ({
      entries: id === 'open' ? [{ filePath: 'a.ts', status: 'M', staged: false }] : [],
    })) as any);
    await openDialog();

    await fireEvent.click(await screen.findByRole('button', { name: 'Select all except 1 with changes' }));
    expect(screen.getByLabelText(/Open one/)).not.toBeChecked();
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
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

describe('Sidebar delete conversation', () => {
  async function openDeleteDialog() {
    store.sessions = [{ id: 's2', branch: 'fix-parser', repoPath: '/repo-a', status: 'stopped' }] as any;
    store.activeSessionId = null;
    mockGroveBench.getCollapsedRepos.mockResolvedValue({ '/repo-a': false });
    render(Sidebar);
    await fireEvent.click(await screen.findByTitle('Delete conversation'));
    return screen.findByRole('dialog');
  }

  it('warns about uncommitted files before deleting', async () => {
    mockGroveBench.getGitStatus.mockResolvedValueOnce({ entries: [{ filePath: 'a.ts', status: 'modified', staged: false }, { filePath: 'b.ts', status: 'untracked', staged: false }] } as any);
    const dialog = await openDeleteDialog();
    expect(dialog).toHaveTextContent('Delete conversation?');
    expect(await screen.findByText('2 files have uncommitted changes that will be lost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('warns about commits the base branch lacks once the branch is to be deleted too', async () => {
    mockGroveBench.getBranchCommits.mockResolvedValueOnce([{ subject: 'Fix parser', body: '' }] as any);
    await openDeleteDialog();
    await waitFor(() => expect(mockGroveBench.getBranchCommits).toHaveBeenCalledWith('s2', 'main'));
    expect(screen.queryByText(/isn't on main yet/)).toBeNull();

    await fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText(/1 commit on fix-parser isn't on main yet/)).toBeInTheDocument();
  });

  it('says a conversation in a folder without git leaves the files alone', async () => {
    store.sessions = [{ id: 'n1', branch: '', repoPath: '/repo-a', status: 'stopped', direct: true, noGit: true }] as any;
    store.activeSessionId = null;
    mockGroveBench.getCollapsedRepos.mockResolvedValue({ '/repo-a': false });
    render(Sidebar);
    await fireEvent.click(await screen.findByTitle('Delete conversation'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('It worked in the project folder itself, so no files are deleted.');
    expect(screen.queryByText('Also delete the branch')).toBeNull();
  });

  it('deletes after confirming', async () => {
    const { destroySession } = mockGroveBench;
    await openDeleteDialog();
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(destroySession).toHaveBeenCalledWith('s2', false));
  });

  it('waits for its checks before Delete can be pressed', async () => {
    let finish!: (v: { entries: [] }) => void;
    mockGroveBench.getGitStatus.mockReturnValueOnce(new Promise((r) => { finish = r; }) as any);
    await openDeleteDialog();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    finish({ entries: [] });
    expect(await screen.findByRole('button', { name: 'Delete' })).not.toBeDisabled();
  });

  it('does not count the settings file Grove writes into every worktree', async () => {
    mockGroveBench.getGitStatus.mockResolvedValueOnce({ entries: [{ filePath: '.claude/settings.local.json', status: 'untracked', staged: false }] } as any);
    await openDeleteDialog();
    await screen.findByRole('button', { name: 'Delete' });
    expect(screen.queryByText(/uncommitted changes that will be lost/)).toBeNull();
  });

describe('Sidebar projects tree', () => {
  beforeEach(() => {
    store.sessions = [
      { id: 'live', branch: 'feat-live', repoPath: '/repo-a', status: 'running', displayName: 'Live one' },
      { id: 'a1', branch: 'shared', repoPath: '/repo-a', status: 'stopped', displayName: 'First on shared' },
      { id: 'a2', branch: 'shared', repoPath: '/repo-a', status: 'stopped', displayName: 'Second on shared' },
    ] as any;
    store.activeSessionId = null;
    mockGroveBench.getCollapsedRepos.mockResolvedValue({ '/repo-a': false });
  });

  it('lists open conversations here too, and they open like any other row', async () => {
    render(Sidebar);
    // Once under Conversations, once under the project.
    await waitFor(() => expect(screen.getAllByText('Live one')).toHaveLength(2));
    const rows = screen.getAllByText('Live one').map((el) => el.closest('button')!);
    expect(rows[1]).not.toBeDisabled();

    await fireEvent.click(rows[1]);
    expect(store.activeSessionId).toBe('live');
  });

  it('folds and unfolds a branch group from its header', async () => {
    render(Sidebar);
    const header = await screen.findByRole('button', { name: /shared \(2\)/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('First on shared')).toBeInTheDocument();

    await fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('First on shared')).toBeNull();
    expect(screen.queryByText('Second on shared')).toBeNull();

    await fireEvent.click(header);
    expect(screen.getByText('Second on shared')).toBeInTheDocument();
  });
});

describe('Sidebar remove project', () => {
  const { destroySession, removeRepo } = mockGroveBench;

  beforeEach(() => {
    store.repos = ['/repo-a', '/repo-b'];
    store.sessions = [
      { id: 'w1', branch: 'feat-one', repoPath: '/repo-a', status: 'running', displayName: 'Worktree one' },
      { id: 'w2', branch: 'feat-two', repoPath: '/repo-a', status: 'stopped', displayName: 'Worktree two' },
      { id: 'd1', branch: 'main', repoPath: '/repo-a', status: 'stopped', direct: true, displayName: 'Direct one' },
      { id: 'other', branch: 'feat-x', repoPath: '/repo-b', status: 'stopped', displayName: 'Elsewhere' },
    ] as any;
    store.activeSessionId = null;
    destroySession.mockReset().mockResolvedValue(undefined);
    removeRepo.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockGroveBench.getGitStatus.mockReset();
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
    mockGroveBench.getBranchCommits.mockReset();
    mockGroveBench.getBranchCommits.mockResolvedValue([]);
  });

  async function openRemoveDialog() {
    render(Sidebar);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove project repo-a' }));
    return screen.findByRole('dialog');
  }

  it('is offered while the project still has conversations, and says they go too', async () => {
    const dialog = await openRemoveDialog();
    expect(dialog).toHaveTextContent('This also deletes its 3 conversations and their copies of the project (worktrees).');
    expect(dialog).toHaveTextContent("The project folder itself isn't touched.");
  });

  it('warns about uncommitted changes, checking only worktree conversations', async () => {
    mockGroveBench.getGitStatus.mockImplementation((async (id: string) => ({
      entries: id === 'w2' ? [{ filePath: 'a.ts', status: 'modified', staged: false }] : [],
    })) as any);
    await openRemoveDialog();
    expect(await screen.findByText('1 conversation has uncommitted changes that will be lost.')).toBeInTheDocument();
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalledWith('d1');
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalledWith('other');
  });

  it('warns about unmerged commits once the branches are to be deleted too', async () => {
    mockGroveBench.getBranchCommits.mockImplementation((async (id: string) => (id === 'w1' ? [{ subject: 'x', body: '' }] : [])) as any);
    await openRemoveDialog();
    await screen.findByRole('button', { name: 'Remove' });
    expect(screen.queryByText(/aren't on main yet/)).toBeNull();

    await fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText(/1 branch has commits that aren't on main yet/)).toBeInTheDocument();
  });

  it('waits for its checks before Remove can be pressed', async () => {
    let finish!: (v: { entries: [] }) => void;
    mockGroveBench.getGitStatus.mockReturnValueOnce(new Promise((r) => { finish = r; }) as any);
    await openRemoveDialog();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    finish({ entries: [] });
    expect(await screen.findByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });

  it('says which conversations are running and will be stopped', async () => {
    messageStore.setIsRunning('w1', true);
    const dialog = await openRemoveDialog();
    expect(dialog).toHaveTextContent('1 conversation is running and will be stopped, 1 in the middle of a turn.');
  });

  it('runs at most 3 git checks at once', async () => {
    store.sessions = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, branch: `b${i}`, repoPath: '/repo-a', status: 'stopped' })) as any;
    let inFlight = 0;
    let most = 0;
    mockGroveBench.getGitStatus.mockImplementation((async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { entries: [] };
    }) as any);
    await openRemoveDialog();
    await screen.findByRole('button', { name: 'Remove' });
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(8);
    expect(most).toBe(3);
  });

  it('checks again, rather than delete it unchecked, when a conversation starts while the dialog is open', async () => {
    await openRemoveDialog();
    await fireEvent.click(screen.getByRole('checkbox'));
    await screen.findByRole('button', { name: 'Remove' });
    store.sessions = [...store.sessions, { id: 'late', branch: 'feat-late', repoPath: '/repo-a', status: 'running' }] as any;

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(destroySession).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('New conversations started in this project, so it checked again.');
    expect(dialog).toHaveTextContent('This also deletes its 4 conversations');
    expect(screen.getByRole('checkbox')).toBeChecked();
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('late'));
  });

  it("deletes each of the project's conversations, then the project", async () => {
    await openRemoveDialog();
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeRepo).toHaveBeenCalledWith('/repo-a'));
    expect(destroySession.mock.calls).toEqual([['w1', true], ['w2', true], ['d1', true]]);
    expect(store.repos).toEqual(['/repo-b']);
    expect(store.sessions.map((s) => s.id)).toEqual(['other']);
  });

  it('keeps the project when a conversation fails to delete', async () => {
    destroySession.mockImplementation(async (id: string) => { if (id === 'w2') throw new Error('locked'); });
    await openRemoveDialog();
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(destroySession.mock.calls.map(([id]) => id)).toEqual(['w1', 'w2']);
    expect(removeRepo).not.toHaveBeenCalled();
    expect(store.repos).toContain('/repo-a');
    expect(store.error).toBe('locked');
    store.error = null;
  });
});

describe('Sidebar rows for folder projects without git', () => {
  it('names a conversation with no branch and no name yet "New conversation"', async () => {
    store.sessions = [
      { id: 'n1', branch: '', repoPath: '/repo-a', status: 'running', direct: true, noGit: true, displayName: null },
    ] as any;
    render(Sidebar);
    expect(await screen.findByText('New conversation')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'In the project folder (no git)' })).toBeInTheDocument();
  });
});
});

describe('Sidebar rail', () => {
  afterEach(() => {
    panelStore.collapsed = {};
  });

  it('folds to a rail of open conversations that still switches between them', async () => {
    store.sessions = [
      { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running', displayName: 'Sidebar revamp' },
      { id: 's2', branch: 'feat-y', repoPath: '/repo-a', status: 'running', displayName: 'Fix login' },
    ] as any;
    const { container } = render(Sidebar);
    const aside = container.querySelector('aside')!;
    expect(container.querySelector('[data-rail-session]')).toBeNull();

    await fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(mockGroveBench.setCollapsedPanels).toHaveBeenCalledWith({ sidebar: true });
    expect(aside.style.width).toBe('48px');
    const s2 = container.querySelector('[data-rail-session="s2"]') as HTMLButtonElement;
    expect(s2.getAttribute('aria-label')).toBe('repo-a / Fix login');

    await fireEvent.click(s2);
    expect(store.activeSessionId).toBe('s2');
    expect(s2.className).toContain('bg-sidebar-accent');

    // The full sidebar stays mounted but hidden, so use the rail's own button.
    await fireEvent.click(within(container.querySelector('[data-rail]') as HTMLElement).getByLabelText('Expand sidebar'));
    expect(container.querySelector('[data-rail-session]')).toBeNull();
    expect(aside.style.width).toBe('300px');
  });
});
