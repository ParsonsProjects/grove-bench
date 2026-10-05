import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

import { flushSync } from 'svelte';

import App from './App.svelte';
import { store } from './stores/sessions.svelte.js';
import { messageStore } from './stores/messages.svelte.js';
import { settingsStore } from './stores/settings.svelte.js';
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
