import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';

import StatusBar from './StatusBar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { CONTROL_IDS } from '../../shared/types.js';

const ACTIVE = 's-active';
const HIDDEN = 's-hidden';

beforeEach(() => {
  store.sessions = [
    { id: ACTIVE, branch: 'feat-a', repoPath: '/repo', status: 'running', agentType: 'claude-code' },
    { id: HIDDEN, branch: 'feat-b', repoPath: '/repo', status: 'running', agentType: 'claude-code' },
  ] as any;
  store.activeSessionId = ACTIVE;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.sessions = [];
  store.activeSessionId = null;
});

describe('StatusBar keyboard shortcuts', () => {
  // Every conversation's WorkspacePane (and so its StatusBar) is mounted at
  // once, so a window shortcut must only reach the active conversation.
  it.each([
    ['m', CONTROL_IDS.permissionMode],
    ['t', CONTROL_IDS.thinking],
    ['e', CONTROL_IDS.effort],
  ])('Alt+%s cycles %s on the active conversation only', async (key, controlId) => {
    const cycle = vi.spyOn(messageStore, 'cycleControl').mockImplementation(() => {});
    render(StatusBar, { props: { sessionId: ACTIVE } });
    render(StatusBar, { props: { sessionId: HIDDEN } });

    await fireEvent.keyDown(window, { key, altKey: true });

    expect(cycle).toHaveBeenCalledTimes(1);
    expect(cycle).toHaveBeenCalledWith(ACTIVE, controlId);
  });

  it('does nothing when no conversation is active', async () => {
    store.activeSessionId = null;
    const cycle = vi.spyOn(messageStore, 'cycleControl').mockImplementation(() => {});
    render(StatusBar, { props: { sessionId: ACTIVE } });
    render(StatusBar, { props: { sessionId: HIDDEN } });

    await fireEvent.keyDown(window, { key: 'm', altKey: true });

    expect(cycle).not.toHaveBeenCalled();
  });
});

describe('StatusBar context grove', () => {
  afterEach(() => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: true };
    delete messageStore.usageBySession[ACTIVE];
    delete messageStore.contextWindowBySession[ACTIVE];
  });

  function useContext(tokens: number) {
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  it('is bare ground before any context is used', () => {
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(getByTestId('context-grove').querySelectorAll('path')).toHaveLength(0);
  });

  it('grows as the context fills', () => {
    useContext(100_000);
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(getByTestId('context-grove').querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('is hidden with grove characters off', () => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    useContext(100_000);
    const { queryByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(queryByTestId('context-grove')).toBeNull();
  });
});
