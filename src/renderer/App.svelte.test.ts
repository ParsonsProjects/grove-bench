import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

import App from './App.svelte';
import { store } from './stores/sessions.svelte.js';
import { settingsStore } from './stores/settings.svelte.js';
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
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.deferredResume = {};
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

    expect(await screen.findByText('Pick a conversation', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(store.activeSessionId).toBeNull();
    // Both stay listed as open, and neither starts its agent until opened.
    expect(store.deferredResume).toEqual({ a: true, b: true });
    expect(mockGroveBench.resumeSession).not.toHaveBeenCalled();
  });
});
