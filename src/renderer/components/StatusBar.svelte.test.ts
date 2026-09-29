import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import StatusBar from './StatusBar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { rateLimitStore } from '../stores/rateLimit.svelte.js';
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

describe('StatusBar MCP controls follow the agent', () => {
  const ID = 's-mcp';
  const NONE = { list: false, reconnect: false, toggle: false, signIn: false, contextCost: false };

  function useAgent(mcp?: import('../../shared/types.js').McpSupport) {
    agentsStore.list = [{ id: 'agent-x', displayName: 'Agent X', capabilities: {}, isDefault: true, ...(mcp ? { mcp } : {}) }];
    agentsStore.loaded = true;
    store.sessions = [{ id: ID, branch: 'b', repoPath: '/repo', status: 'running', agentType: 'agent-x' }] as any;
    store.activeSessionId = ID;
  }

  afterEach(() => {
    agentsStore.list = [];
    agentsStore.loaded = false;
    delete messageStore.systemInfoBySession[ID];
  });

  it('offers no controls for an agent without MCP support', async () => {
    useAgent();
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await fireEvent.click(screen.getByRole('button', { name: /MCP 1/ }));

    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it("uses the agent's own words for Disconnect", async () => {
    useAgent({ controls: { ...NONE, list: true, toggle: true }, disconnectHint: 'Off until this conversation restarts' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await fireEvent.click(screen.getByRole('button', { name: /MCP 1/ }));

    expect(screen.getByRole('button', { name: 'Disconnect' }).getAttribute('title')).toBe('Off until this conversation restarts');
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('shows the badge for an agent that only reports servers when asked', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    vi.mocked(window.groveBench.listMcpServers).mockResolvedValueOnce([{ name: 'docs', status: 'connected' }]);
    render(StatusBar, { props: { sessionId: ID } });

    await waitFor(() => expect(screen.getByRole('button', { name: /MCP 1/ })).toBeTruthy());
  });
});

describe('StatusBar rate limit', () => {
  afterEach(() => rateLimitStore.destroy(ACTIVE));

  it('shows the warning under the activity view toggle', () => {
    rateLimitStore.set(ACTIVE, { status: 'allowed_warning', utilization: 0.85 });
    const { getByTestId, getByRole } = render(StatusBar, { props: { sessionId: ACTIVE } });
    const warning = getByTestId('rate-limit');
    expect(warning.textContent).toMatch(/rate warning\s+\(85%\)/);
    expect(getByRole('button', { name: /^Activity view:/ }).nextElementSibling).toBe(warning);
  });

  it('shows nothing while requests are allowed', () => {
    rateLimitStore.set(ACTIVE, { status: 'allowed' });
    const { queryByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(queryByTestId('rate-limit')).toBeNull();
  });
});

describe('StatusBar context grove', () => {
  afterEach(() => {
    vi.useRealTimers();
    settingsStore.current = { ...settingsStore.current, groveCharacters: true };
    for (const id of [ACTIVE, HIDDEN]) {
      delete messageStore.usageBySession[id];
      delete messageStore.contextWindowBySession[id];
    }
  });

  function useContext(tokens: number) {
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  it('is bare ground before any context is used', () => {
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(getByTestId('context-grove').querySelectorAll('path')).toHaveLength(0);
  });

  it('grows as the context fills', async () => {
    vi.useFakeTimers();
    useContext(100_000);
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    // The open conversation's grove grows in, so give it time to.
    await vi.advanceTimersByTimeAsync(5000);
    expect(getByTestId('context-grove').querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('shows a hidden conversation\'s grove at once', () => {
    messageStore.contextWindowBySession[HIDDEN] = 200_000;
    messageStore.usageBySession[HIDDEN] = { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const { getByTestId } = render(StatusBar, { props: { sessionId: HIDDEN } });
    expect(getByTestId('context-grove').querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('is hidden with grove characters off', () => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    useContext(100_000);
    const { queryByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(queryByTestId('context-grove')).toBeNull();
  });
});

describe('StatusBar context actions', () => {
  afterEach(() => {
    delete messageStore.usageBySession[ACTIVE];
    delete messageStore.contextWindowBySession[ACTIVE];
  });

  async function openContext() {
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: 150_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(screen.getByTitle('Context usage — click for details'));
  }

  it('asks before clearing the conversation, and Cancel keeps it', async () => {
    const send = vi.spyOn(messageStore, 'sendCommand').mockImplementation(() => {});
    await openContext();

    await fireEvent.click(screen.getByRole('button', { name: 'Start fresh…' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Your files stay as they are');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(send).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Start fresh…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(send).toHaveBeenCalledWith(ACTIVE, '/clear');
  });

  it('summarises without asking', async () => {
    const send = vi.spyOn(messageStore, 'sendCommand').mockImplementation(() => {});
    await openContext();
    await fireEvent.click(screen.getByRole('button', { name: 'Summarise to free space' }));
    expect(send).toHaveBeenCalledWith(ACTIVE, '/compact');
  });
});
