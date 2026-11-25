import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

import { flushSync } from 'svelte';

import App from './App.svelte';
import { store } from './stores/sessions.svelte.js';
import { messageStore } from './stores/messages.svelte.js';
import { settingsStore } from './stores/settings.svelte.js';
import { boardStore } from './stores/board.svelte.js';
import { followUpsStore } from './stores/followUps.svelte.js';
import { agentMonitorStore } from './stores/agentMonitor.svelte.js';
import { TURN_SETTLE_MS } from './lib/turn-end.js';
import { mockGroveBench } from './__mocks__/setup.js';

// Bridge calls the whole app makes that the shared mock doesn't define.
const getOpenTabs = vi.fn(async (): Promise<string[]> => []);
Object.assign(mockGroveBench, {
  getOpenTabs,
  setOpenTabs: vi.fn(),
  onSessionStatus: vi.fn(() => () => {}),
  onPowerResume: vi.fn(() => () => {}),
  onFocusSession: vi.fn(() => () => {}),
  onUpdateStatus: vi.fn(() => () => {}),
  winIsMaximized: vi.fn(async () => false),
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.deferredResume = {};
  store.needsAttention = {};
  messageStore.isRunning = {};
  agentMonitorStore.open = false;
});

describe('App startup', () => {
  it('lands on the picker with the open conversations and opens none of them', async () => {
    const settings = JSON.parse(JSON.stringify(settingsStore.current));
    mockGroveBench.getSettings.mockResolvedValue(settings);
    mockGroveBench.listRepos.mockResolvedValue(['/repo']);
    mockGroveBench.listWorktrees.mockResolvedValue([
      { id: 'a', branch: 'feat-a', repoPath: '/repo', path: '/wt/a', createdAt: 1, lastActiveAt: 1 },
      { id: 'b', branch: 'feat-b', repoPath: '/repo', path: '/wt/b', createdAt: 2, lastActiveAt: 2 },
    ]);
    getOpenTabs.mockResolvedValue(['a', 'b']);
    mockGroveBench.resumeSession.mockClear();

    render(App);

    expect(await screen.findByText('Pick a thread', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(store.activeSessionId).toBeNull();
    // Both stay listed as open, and neither starts its agent until opened.
    expect(store.deferredResume).toEqual({ a: true, b: true });
    expect(mockGroveBench.resumeSession).not.toHaveBeenCalled();
  });

  it('keeps a thread started while the restore runs', async () => {
    const settings = JSON.parse(JSON.stringify(settingsStore.current));
    mockGroveBench.getSettings.mockResolvedValue(settings);
    mockGroveBench.listRepos.mockResolvedValue(['/repo']);
    // Live in main but closed before the reload: the restore closes it.
    mockGroveBench.listSessions.mockResolvedValueOnce([
      { id: 'old', branch: 'feat-old', repoPath: '/repo', worktreePath: '/wt/old', status: 'running', agentType: 'claude-code', createdAt: 1 },
    ]);
    mockGroveBench.listWorktrees.mockResolvedValue([
      { id: 'old', branch: 'feat-old', repoPath: '/repo', path: '/wt/old', createdAt: 1, lastActiveAt: 1 },
    ]);
    let openTabs!: (ids: string[]) => void;
    getOpenTabs.mockReturnValueOnce(new Promise((r) => { openTabs = r; }));
    mockGroveBench.closeSession.mockClear();

    render(App);
    await vi.waitFor(() => expect(getOpenTabs).toHaveBeenCalled(), { timeout: 5000 });
    // Started from the draft while the restore was still running; not in the
    // saved tabs yet.
    store.addSession({ id: 'new1', branch: 'main', repoPath: '/repo', status: 'running', direct: true }, false);
    openTabs([]);

    await vi.waitFor(() => expect(mockGroveBench.closeSession).toHaveBeenCalledWith('old'));
    expect(mockGroveBench.closeSession).not.toHaveBeenCalledWith('new1');
    expect(store.sessions.find((s) => s.id === 'new1')?.status).toBe('running');
  });
});

describe('App shortcuts', () => {
  it('opens and closes Settings with Ctrl+,', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(App);

    await fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(settingsStore.panelOpen).toBe(true);
    await fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(settingsStore.panelOpen).toBe(false);
  });

  it('opens and closes the agent monitor with Ctrl+Shift+A', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(App);

    await fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Agent monitor' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(agentMonitorStore.open).toBe(false);
  });

  it('docks Bookmarks beside the landing when no thread is open, and Ctrl+B closes it again', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(App);

    await fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(await screen.findByRole('complementary', { name: 'Bookmarks' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.queryByRole('complementary', { name: 'Bookmarks' })).toBeNull();
  });

  it('docks Bookmarks beside a thread that is stopped, whose pane isn\'t shown', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(App);
    store.sessions = [{ id: 'gone', branch: 'feat-x', repoPath: '/repo', status: 'stopped' }];
    store.activeSessionId = 'gone';

    await fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(await screen.findByRole('complementary', { name: 'Bookmarks' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  });
});

describe('App unread flag', () => {
  /** Render the app, then put one working conversation in the background. */
  async function renderWithWorkingConversation() {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    render(App);
    await screen.findByText('Add a project to get started.', {}, { timeout: 5000 });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    store.sessions = [{ id: 'w', branch: 'feat-w', repoPath: '/repo', status: 'running' }] as any;
    // Its own flush first: a new conversation's setup resets its running flag.
    flushSync();
    messageStore.setIsRunning('w', true);
    flushSync();
  }

  it('marks a conversation unread when its turn finishes in the background', async () => {
    await renderWithWorkingConversation();

    messageStore.setIsRunning('w', false);
    flushSync();
    vi.advanceTimersByTime(TURN_SETTLE_MS);

    expect(store.needsAttention.w).toBe(true);
  });

  it('keeps the open thread unread when it is marked so, until it is opened again', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    render(App);
    await screen.findByText('Add a project to get started.', {}, { timeout: 5000 });

    store.sessions = [
      { id: 'a', branch: 'feat-a', repoPath: '/repo', status: 'running' },
      { id: 'b', branch: 'feat-b', repoPath: '/repo', status: 'running' },
    ] as any;
    store.activeSessionId = 'a';
    flushSync();
    // What the sidebar's Mark as Unread does.
    store.markNeedsAttention('a');
    flushSync();
    expect(store.needsAttention.a).toBe(true);

    store.activeSessionId = 'b';
    flushSync();
    expect(store.needsAttention.a).toBe(true);
    store.activeSessionId = 'a';
    flushSync();
    expect(store.needsAttention.a).toBeUndefined();
  });

  it('brings back last run\'s unread flags, but not on a thread opened while they load', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    mockGroveBench.notifyRestoreComplete.mockClear();
    mockGroveBench.getUnreadSessions.mockImplementationOnce(async () => {
      // The projects have loaded and the user opened 'a' meanwhile.
      store.sessions = [
        { id: 'a', branch: 'feat-a', repoPath: '/repo', status: 'running' },
        { id: 'b', branch: 'feat-b', repoPath: '/repo', status: 'running' },
      ] as any;
      store.activeSessionId = 'a';
      return ['a', 'b'];
    });
    render(App);
    await vi.waitFor(() => expect(mockGroveBench.notifyRestoreComplete).toHaveBeenCalled(), { timeout: 5000 });
    flushSync();

    expect(store.needsAttention.a).toBeUndefined();
    expect(store.needsAttention.b).toBe(true);
  });

  it('brings back the flags of restored tabs, but not of closed threads, which count as dealt with', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue(['/repo']);
    mockGroveBench.listWorktrees.mockResolvedValue([
      { id: 'tab', branch: 'feat-a', repoPath: '/repo', path: '/wt/tab', createdAt: 1, lastActiveAt: 1 },
      { id: 'closed', branch: 'feat-b', repoPath: '/repo', path: '/wt/closed', createdAt: 2, lastActiveAt: 2 },
    ]);
    // Both come back stopped; only the saved tab is open, waiting to reconnect.
    getOpenTabs.mockResolvedValue(['tab']);
    mockGroveBench.notifyRestoreComplete.mockClear();
    mockGroveBench.getUnreadSessions.mockResolvedValueOnce(['tab', 'closed']);
    render(App);
    await vi.waitFor(() => expect(mockGroveBench.notifyRestoreComplete).toHaveBeenCalled(), { timeout: 5000 });
    flushSync();

    expect(store.deferredResume).toEqual({ tab: true });
    expect(store.needsAttention).toEqual({ tab: true });
  });

  /** Run with the taskbar badge on or off, whatever an earlier test left
   *  (CI shuffles them), then put the settings back. */
  async function withBadge(on: boolean, run: () => Promise<void>) {
    const before = JSON.parse(JSON.stringify(settingsStore.current)) as typeof settingsStore.current;
    const draftBefore = JSON.parse(JSON.stringify(settingsStore.draft)) as typeof settingsStore.draft;
    // The draft too: startup's load saves a draft that differs from current.
    const settings = { ...before, notifyTaskbarBadge: on };
    settingsStore.current = settings;
    settingsStore.draft = JSON.parse(JSON.stringify(settings)) as typeof settingsStore.draft;
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settings)));
    try {
      await run();
    } finally {
      settingsStore.current = before;
      settingsStore.draft = draftBefore;
      mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(before)));
      // The app's own load may still be on its way with this test's
      // setting: this one lands after it, so the next test starts from the
      // settings as they were.
      await settingsStore.load();
    }
  }

  it('leaves a closed thread out of the taskbar badge, as the sidebar does', () => withBadge(true, async () => {
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    render(App);
    await screen.findByText('Add a project to get started.', {}, { timeout: 5000 });

    store.sessions = [
      { id: 'open', branch: 'feat-a', repoPath: '/repo', status: 'running' },
      // Its agent stopped by itself after the turn that flagged it.
      { id: 'closed', branch: 'feat-b', repoPath: '/repo', status: 'stopped' },
    ] as any;
    store.needsAttention = { open: true, closed: true };
    flushSync();

    expect(mockGroveBench.setAttentionBadge).toHaveBeenLastCalledWith(1, null, 1);
  }));

  it('still tells the tray how many threads need attention with the badge turned off', () => withBadge(false, async () => {
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    render(App);
    await screen.findByText('Add a project to get started.', {}, { timeout: 5000 });

    store.sessions = [{ id: 'open', branch: 'feat-a', repoPath: '/repo', status: 'running' }] as any;
    store.needsAttention = { open: true };
    flushSync();

    expect(mockGroveBench.setAttentionBadge).toHaveBeenLastCalledWith(0, null, 1);
  }));

  it('does not mark it unread when it is closed mid-turn', async () => {
    await renderWithWorkingConversation();

    // What Close Conversation does, then the 'stopped' status main sends back.
    store.updateStatus('w', 'stopped');
    messageStore.markSessionStopped('w');
    flushSync();
    vi.advanceTimersByTime(TURN_SETTLE_MS);

    expect(store.needsAttention.w).toBeUndefined();
  });
});

describe('App status from main', () => {
  it('keeps a new thread working on its first prompt when its agent comes up', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    mockGroveBench.notifyRestoreComplete.mockClear();
    render(App);
    await vi.waitFor(() => expect(mockGroveBench.notifyRestoreComplete).toHaveBeenCalled(), { timeout: 5000 });
    const [onStatus] = mockGroveBench.onSessionStatus.mock.calls.at(-1) as unknown as [(id: string, status: string) => void];
    // Sent from the draft as the thread was added.
    store.sessions = [{ id: 'f', branch: 'feat-f', repoPath: '/repo', status: 'starting' }] as any;
    messageStore.addUserMessage('f', 'Add a hello world test');
    flushSync();

    // A worktree thread's agent is up: main says 'running' before system_init.
    onStatus('f', 'running');
    flushSync();

    expect(messageStore.getIsReady('f')).toBe(true);
    expect(messageStore.getIsRunning('f')).toBe(true);
    messageStore.destroySession('f');
  });
});

describe('App auto-resume', () => {
  /** Render the app and open stopped conversation 's', whose resume then
   *  succeeds. Returns the handler for statuses main sends. */
  async function openStoppedConversation() {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    mockGroveBench.notifyRestoreComplete.mockClear();
    render(App);
    await vi.waitFor(() => expect(mockGroveBench.notifyRestoreComplete).toHaveBeenCalled(), { timeout: 5000 });
    const [onStatus] = mockGroveBench.onSessionStatus.mock.calls.at(-1) as unknown as [(id: string, status: string) => void];
    mockGroveBench.resumeSession.mockClear();
    mockGroveBench.resumeSession.mockResolvedValue({ id: 's' });

    store.sessions = [{ id: 's', branch: 'feat-s', repoPath: '/repo', status: 'stopped' }] as any;
    store.activeSessionId = 's';
    flushSync();
    expect(mockGroveBench.resumeSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(store.sessions[0].status).toBe('running'));
    return onStatus;
  }

  it('does not resume again in a loop when the resumed agent stops before connecting', async () => {
    const onStatus = await openStoppedConversation();

    // Its agent exits before it connects (e.g. it can't find the conversation).
    onStatus('s', 'stopped');
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockGroveBench.resumeSession).toHaveBeenCalledTimes(1);

    // Opening it again is a deliberate retry.
    store.activeSessionId = null;
    flushSync();
    store.activeSessionId = 's';
    flushSync();
    expect(mockGroveBench.resumeSession).toHaveBeenCalledTimes(2);
  });

  it('still resumes an agent that stops after it connected', async () => {
    const onStatus = await openStoppedConversation();

    onStatus('s', 'running');
    onStatus('s', 'stopped');
    flushSync();
    expect(mockGroveBench.resumeSession).toHaveBeenCalledTimes(2);
  });
});

describe('App: back in the window', () => {
  it('reads the git status of the thread on screen again', async () => {
    const { gitStatusStore } = await import('./stores/gitStatus.svelte.js');
    const settings = JSON.parse(JSON.stringify(settingsStore.current)) as typeof settingsStore.current;
    mockGroveBench.getSettings.mockResolvedValue(settings);
    let focused = () => {};
    mockGroveBench.onWindowFocus.mockImplementation(((callback: () => void) => {
      focused = callback;
      return () => {};
    }) as never);
    render(App);
    await screen.findByText('Add a project to get started.');
    const refresh = vi.spyOn(gitStatusStore, 'refresh').mockResolvedValue(undefined);
    try {
      store.sessions = [{ id: 'on-screen', branch: 'feat', repoPath: '/repo', status: 'running' }] as never;
      store.activeSessionId = 'on-screen';
      focused();
      expect(refresh).toHaveBeenCalledWith('on-screen');
    } finally {
      refresh.mockRestore();
    }
  });
});

describe('App: a thread whose history is loading', () => {
  async function openLoadingThread(groveCharacters: boolean) {
    mockGroveBench.getSettings.mockResolvedValue({ ...JSON.parse(JSON.stringify(settingsStore.current)), groveCharacters });
    mockGroveBench.listRepos.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    mockGroveBench.notifyRestoreComplete.mockClear();
    render(App);
    await vi.waitFor(() => expect(mockGroveBench.notifyRestoreComplete).toHaveBeenCalled(), { timeout: 5000 });
    // Its agent is up; only the history is still on its way.
    store.sessions = [{ id: 'h', branch: 'feat-h', repoPath: '/repo', status: 'running' }] as any;
    store.activeSessionId = 'h';
    flushSync();
  }

  const original = mockGroveBench.getEventHistoryPage.getMockImplementation();
  afterEach(() => {
    if (original) mockGroveBench.getEventHistoryPage.mockImplementation(original);
    messageStore.destroySession('h');
    settingsStore.current.groveCharacters = true;
  });

  it.each([true, false])('says it is loading the thread, not starting its agent (grove characters %s)', async (grove) => {
    mockGroveBench.getEventHistoryPage.mockImplementation(() => new Promise(() => {}));
    await openLoadingThread(grove);
    expect(await screen.findByText('Loading thread...')).toBeInTheDocument();
    expect(screen.queryByText('Starting agent...')).toBeNull();
  });
});

describe('App board (alpha)', () => {
  // The settings as they were, so these tests leave the board off after them.
  let settingsBefore: typeof settingsStore.current;
  let draftBefore: typeof settingsStore.draft;
  beforeEach(() => {
    settingsBefore = JSON.parse(JSON.stringify(settingsStore.current)) as typeof settingsStore.current;
    draftBefore = JSON.parse(JSON.stringify(settingsStore.draft)) as typeof settingsStore.draft;
    // No projects or threads unless a test adds them: in a shuffled run the
    // test before may have left some to restore, and their cards would hide
    // the empty board.
    mockGroveBench.listRepos.mockResolvedValue([]);
    mockGroveBench.listWorktrees.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
  });

  afterEach(() => {
    boardStore.close();
    settingsStore.current = settingsBefore;
    settingsStore.draft = draftBefore;
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsBefore)));
    mockGroveBench.listRepos.mockResolvedValue([]);
    mockGroveBench.listWorktrees.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
  });

  // The draft too: startup's settingsStore.load() saves a draft that differs
  // from `current` first, which would put the board back off.
  function withBoard() {
    const settings = { ...JSON.parse(JSON.stringify(settingsStore.current)), boardView: true };
    mockGroveBench.getSettings.mockResolvedValue(settings);
    settingsStore.current = settings;
    settingsStore.draft = JSON.parse(JSON.stringify(settings)) as typeof settingsStore.draft;
  }

  it('shows the board in the main pane, and gives way when a thread opens', async () => {
    withBoard();
    mockGroveBench.listRepos.mockResolvedValue(['/repo']);
    mockGroveBench.listWorktrees.mockResolvedValue([
      { id: 'a', branch: 'feat-a', repoPath: '/repo', path: '/wt/a', createdAt: 1, lastActiveAt: 1 },
    ]);
    getOpenTabs.mockResolvedValue(['a']);
    render(App);
    // Restored at startup: an open tab, asleep until it is opened.
    expect(await screen.findByText('Pick a thread', {}, { timeout: 5000 })).toBeInTheDocument();

    boardStore.show();
    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(document.querySelector('[data-board-column="review"] [data-board-card="a"]')).not.toBeNull();
    expect(screen.queryByText('Pick a thread')).toBeNull();

    store.activeSessionId = 'a';
    flushSync();
    expect(boardStore.open).toBe(false);
    expect(document.querySelector('[data-board]')).toBeNull();
  });

  it('closes when its setting is turned off', async () => {
    withBoard();
    // No threads, whatever the test before left in these mocks, so the
    // board's empty state shows.
    mockGroveBench.listRepos.mockResolvedValue([]);
    mockGroveBench.listWorktrees.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
    render(App);
    boardStore.show();
    expect(await screen.findByText('No open threads', {}, { timeout: 5000 })).toBeInTheDocument();

    settingsStore.current = { ...settingsStore.current, boardView: false };
    flushSync();
    expect(boardStore.open).toBe(false);
  });
});

describe('App grove map (alpha)', () => {
  // The draft too: startup's settingsStore.load() saves a draft that differs
  // from `current` first, which would put the setting back.
  function withGroveMap(on: boolean) {
    const settings = { ...JSON.parse(JSON.stringify(settingsStore.current)), groveMap: on, boardView: false };
    mockGroveBench.getSettings.mockResolvedValue(settings);
    settingsStore.current = settings;
    settingsStore.draft = JSON.parse(JSON.stringify(settings)) as typeof settingsStore.draft;
  }

  beforeEach(() => {
    mockGroveBench.listRepos.mockResolvedValue(['/repo']);
    mockGroveBench.listWorktrees.mockResolvedValue([
      { id: 'a', branch: 'feat-a', repoPath: '/repo', path: '/wt/a', createdAt: 1, lastActiveAt: 1 },
    ]);
    getOpenTabs.mockResolvedValue(['a']);
  });

  afterEach(() => {
    mockGroveBench.listRepos.mockResolvedValue([]);
    mockGroveBench.listWorktrees.mockResolvedValue([]);
    getOpenTabs.mockResolvedValue([]);
  });

  it('shows the map in place of the Pick a thread list with its setting on', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    withGroveMap(true);
    render(App);
    expect(await screen.findByRole('group', { name: 'Threads by project' }, { timeout: 5000 })).toBeInTheDocument();
    expect(document.querySelector('[data-seat="a"]')).not.toBeNull();

    settingsStore.current = { ...settingsStore.current, groveMap: false };
    flushSync();
    expect(await screen.findByText('Or choose one from the sidebar.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Threads by project' })).toBeNull();
    getContext.mockRestore();
  });

  it('goes back to the landing with Ctrl+G, whichever it is', async () => {
    withGroveMap(false);
    render(App);
    expect(await screen.findByText('Pick a thread', {}, { timeout: 5000 })).toBeInTheDocument();
    store.activeSessionId = 'a';
    flushSync();
    expect(screen.queryByText('Pick a thread')).toBeNull();

    await fireEvent.keyDown(window, { key: 'g', ctrlKey: true });
    expect(store.activeSessionId).toBeNull();
    // The landing: its resume fails against the mocks, so the thread may
    // no longer count as open by now.
    expect(await screen.findByText(/^(Pick a thread|No open threads)$/)).toBeInTheDocument();
  });
});

describe('App New follow-up dialog', () => {
  it('opens when asked for, from the drawer or the board', async () => {
    mockGroveBench.getSettings.mockResolvedValue(JSON.parse(JSON.stringify(settingsStore.current)));
    render(App);
    followUpsStore.openAdd();
    expect(await screen.findByRole('dialog', { name: 'New follow-up' }, { timeout: 5000 })).toBeInTheDocument();
    followUpsStore.closeAdd();
  });
});
