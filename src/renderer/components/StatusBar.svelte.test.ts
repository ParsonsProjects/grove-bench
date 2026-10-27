import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte';

import StatusBar from './StatusBar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { rateLimitStore } from '../stores/rateLimit.svelte.js';
import { prStore } from '../stores/pr.svelte.js';
import { usageStore } from '../stores/usage.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';
import { CONTROL_IDS } from '../../shared/types.js';
import type { PrInfo, ThreadUsage } from '../../shared/types.js';

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

  // jsdom has no Web Animations, which the drawer's slide runs through. This
  // one ends at once, so a closed drawer leaves the page.
  const realAnimate = Element.prototype.animate;

  beforeEach(() => {
    vi.mocked(window.groveBench.reconnectMcpServer).mockClear();
    vi.mocked(window.groveBench.reconnectDownMcpServers).mockClear();
    Element.prototype.animate = vi.fn(() => {
      const animation = { onfinish: null as (() => void) | null, cancel() {}, finished: Promise.resolve(), currentTime: 0 };
      queueMicrotask(() => animation.onfinish?.());
      return animation as unknown as Animation;
    });
  });

  /** The drawer opens from the MCP · Skills lozenge's menu. */
  async function openMcp() {
    await fireEvent.click(await screen.findByTestId('capabilities'));
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'MCP and Skills' })).getByRole('button', { name: /^MCP servers/ }));
  }

  afterEach(() => {
    // Unmount first: emptying the server list below would close an open
    // drawer, and its slide would need the animate mock restored next.
    cleanup();
    agentsStore.list = [];
    agentsStore.loaded = false;
    delete messageStore.systemInfoBySession[ID];
    delete messageStore.mcpLiveBySession[ID];
    vi.mocked(window.groveBench.listMcpServers).mockResolvedValue([]);
    Element.prototype.animate = realAnimate;
  });

  it('opens the servers in a drawer, and closes it on Escape', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();

    const drawer = screen.getByRole('dialog', { name: 'MCP servers' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByText('docs')).toBeInTheDocument();
    expect(within(drawer).getByText('1 of 1 connected')).toBeInTheDocument();

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when another thread opens', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();
    expect(screen.getByRole('dialog', { name: 'MCP servers' })).toBeInTheDocument();

    store.activeSessionId = 'another-thread';

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // The sign-in poll belongs to the thread, not the drawer.
  it('keeps waiting on a sign-in after the drawer closes', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true, signIn: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'cloudflare', status: 'needs-auth' }] };
    vi.mocked(window.groveBench.authenticateMcpServer).mockResolvedValueOnce({ authUrl: 'https://example.com/oauth', callbackExpected: true });
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('button', { name: 'Waiting...' });

    await fireEvent.click(screen.getByRole('button', { name: 'Close MCP servers' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openMcp();

    expect(screen.getByRole('button', { name: 'Waiting...' })).toBeDisabled();
    expect(screen.getByText(/Finish signing in to cloudflare/)).toBeInTheDocument();
  });

  it('offers no controls for an agent without MCP support', async () => {
    useAgent();
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();

    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it("uses the agent's own words for Disconnect", async () => {
    useAgent({ controls: { ...NONE, list: true, toggle: true }, disconnectHint: 'Off until this thread restarts' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();

    expect(screen.getByRole('button', { name: 'Disconnect' }).getAttribute('title')).toBe('Off until this thread restarts');
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('counts the servers of an agent that only reports them when asked', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    vi.mocked(window.groveBench.listMcpServers).mockResolvedValueOnce([{ name: 'docs', status: 'connected' }]);
    render(StatusBar, { props: { sessionId: ID } });

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('MCP 1'));
  });

  it('makes Reconnect green only for a server that failed', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'failed' }, { name: 'search', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();

    const [failed, connected] = screen.getAllByRole('button', { name: 'Reconnect' });
    expect(failed).toHaveClass('text-primary');
    expect(connected).toHaveClass('text-muted-foreground');
  });

  // claude.ai connectors sign in on claude.ai, so nothing redirects back to
  // the agent and the server stays needs-auth until it is reconnected.
  it('offers Reconnect after a sign-in the agent will not finish by itself', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true, signIn: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'claude.ai Cloudflare', status: 'needs-auth' }] };
    vi.mocked(window.groveBench.authenticateMcpServer).mockResolvedValueOnce({ authUrl: 'https://claude.ai/connect', callbackExpected: false });
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText(/then click Reconnect/);
    await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(window.groveBench.reconnectMcpServer).toHaveBeenCalledWith(ID, 'claude.ai Cloudflare');
  });

  it('waits on a sign-in the agent finishes itself, without a Reconnect button', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true, signIn: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'cloudflare', status: 'needs-auth' }] };
    vi.mocked(window.groveBench.authenticateMcpServer).mockResolvedValueOnce({ authUrl: 'https://example.com/oauth', callbackExpected: true });
    render(StatusBar, { props: { sessionId: ID } });

    await openMcp();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('button', { name: 'Waiting...' });
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('shows Refresh working while it checks', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();

    let answer!: (servers: import('../../shared/types.js').McpServerInfo[]) => void;
    vi.mocked(window.groveBench.listMcpServers).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByRole('button', { name: 'Refreshing...' })).toBeDisabled();
    answer([{ name: 'docs', status: 'connected' }]);
    await screen.findByRole('button', { name: 'Refresh' });
  });

  it('Refresh reconnects the servers that are down before checking again', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'needs-auth' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();
    vi.mocked(window.groveBench.listMcpServers).mockClear();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(window.groveBench.listMcpServers).toHaveBeenCalled());
    expect(window.groveBench.reconnectDownMcpServers).toHaveBeenCalledWith(ID);
    expect(vi.mocked(window.groveBench.reconnectDownMcpServers).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(window.groveBench.listMcpServers).mock.invocationCallOrder[0]);
  });

  it('Refresh only checks again when the agent cannot reconnect', async () => {
    useAgent({ controls: { ...NONE, list: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'failed' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await screen.findByRole('button', { name: 'Refresh' });
    expect(window.groveBench.reconnectDownMcpServers).not.toHaveBeenCalled();
  });

  it('reconnects a server in the other threads once a sign-in connects it here', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true, signIn: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'claude.ai Linear', status: 'needs-auth' }] };
    vi.mocked(window.groveBench.authenticateMcpServer).mockResolvedValueOnce({ authUrl: 'https://claude.ai/connect', callbackExpected: false });
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText(/then click Reconnect/);
    expect(window.groveBench.reconnectDownMcpServers).not.toHaveBeenCalled();

    vi.mocked(window.groveBench.listMcpServers).mockResolvedValue([{ name: 'claude.ai Linear', status: 'connected' }]);
    await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(window.groveBench.reconnectDownMcpServers).toHaveBeenCalledWith(ID, 'claude.ai Linear'));
  });

  it('leaves the other threads alone when the server is still down here', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'failed' }] };
    vi.mocked(window.groveBench.listMcpServers).mockResolvedValue([{ name: 'linear', status: 'failed' }]);
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();

    await fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(window.groveBench.reconnectMcpServer).toHaveBeenCalledWith(ID, 'linear'));
    await screen.findByRole('button', { name: 'Reconnect' });
    expect(window.groveBench.reconnectDownMcpServers).not.toHaveBeenCalled();
  });

  it('does not reach the other threads when it cannot read the live status', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true }, disconnectHint: '' });
    // Only the last known status says connected; the live list can't be read.
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'connected' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();

    await fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(window.groveBench.reconnectMcpServer).toHaveBeenCalledWith(ID, 'linear'));
    await screen.findByRole('button', { name: 'Reconnect' });
    expect(window.groveBench.reconnectDownMcpServers).not.toHaveBeenCalled();
  });

  it('shows the status a reconnect in another thread sent for this one', async () => {
    useAgent({ controls: { ...NONE, list: true, reconnect: true }, disconnectHint: '' });
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'needs-auth' }] };
    render(StatusBar, { props: { sessionId: ID } });
    await openMcp();
    await screen.findByText('needs-auth');

    messageStore.updateMcpServers(ID, [{ name: 'linear', status: 'connected', toolCount: 2, tools: [{ name: 'a' }, { name: 'b' }] }]);

    await screen.findByText('connected');
    expect(screen.getByRole('button', { name: '2 tools' })).toBeTruthy();
  });

  // A narrow bar keeps the lozenge's dot, which still shows a server down.
  it.each([
    ['connected', 'bg-green-500', 'MCP 1'],
    ['failed', 'bg-red-500', 'MCP 0/1'],
  ] as const)('keeps only its dot in a narrow bar, coloured by health, when %s', async (status, colour, text) => {
    useAgent();
    messageStore.systemInfoBySession[ID] = { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'docs', status }] };
    render(StatusBar, { props: { sessionId: ID } });

    const lozenge = await screen.findByTestId('capabilities');
    expect(lozenge.querySelector(`.${colour}`)).not.toBeNull();
    expect(within(lozenge).getByText(text)).toHaveClass('hidden', '@3xl:inline');
  });
});

describe('StatusBar rate limit', () => {
  afterEach(() => rateLimitStore.destroy(ACTIVE));

  it('marks the activity lozenge amber, and says why in its popup', async () => {
    rateLimitStore.set(ACTIVE, { status: 'allowed_warning', utilization: 0.85 });
    render(StatusBar, { props: { sessionId: ACTIVE } });
    const lozenge = screen.getByTestId('activity');
    expect(lozenge).toHaveTextContent('Ready');
    expect(lozenge.querySelector('.bg-status-attention')).not.toBeNull();
    expect(lozenge.getAttribute('title')).toContain('rate limit warning');

    await fireEvent.click(lozenge);
    expect(screen.getByTestId('rate-limit').textContent).toMatch(/Rate limit warning\s+\(85%\)/);
  });

  it('says so in the lozenge once requests are refused', () => {
    rateLimitStore.set(ACTIVE, { status: 'rejected' });
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.getByTestId('activity')).toHaveTextContent('Rate limited');
  });

  it('shows nothing while requests are allowed', async () => {
    rateLimitStore.set(ACTIVE, { status: 'allowed' });
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.getByTestId('activity').querySelector('.bg-status-attention')).toBeNull();
    await fireEvent.click(screen.getByTestId('activity'));
    expect(screen.queryByTestId('rate-limit')).toBeNull();
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
    messageStore.usageBySession[ACTIVE] = { inputTokens: tokens, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  /** Every drawn run, as path data: more grove, more of it. */
  const drawn = (el: HTMLElement) => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('');

  it('stands a few small plants before any context is used', () => {
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(getByTestId('context-grove').querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('grows as the context fills', async () => {
    vi.useFakeTimers();
    const empty = render(StatusBar, { props: { sessionId: ACTIVE } });
    const before = drawn(empty.getByTestId('context-grove')).length;
    empty.unmount();
    useContext(100_000);
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    // The open conversation's grove grows in, so give it time to.
    await vi.advanceTimersByTimeAsync(5000);
    expect(drawn(getByTestId('context-grove')).length).toBeGreaterThan(before);
  });

  it('shows a hidden conversation\'s grove at once', () => {
    messageStore.contextWindowBySession[HIDDEN] = 200_000;
    messageStore.usageBySession[HIDDEN] = { inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
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

/** The thread's agent, which can summarise the thread unless told not to. */
function claudeAgent(compact = true) {
  agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: { compact }, isDefault: true }];
  agentsStore.loaded = true;
}

describe('StatusBar context actions', () => {
  beforeEach(() => claudeAgent());
  afterEach(() => {
    delete messageStore.usageBySession[ACTIVE];
    delete messageStore.contextWindowBySession[ACTIVE];
    agentsStore.list = [];
    agentsStore.loaded = false;
  });

  async function openContext() {
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: 150_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(screen.getByRole('button', { name: 'Context 75% used. Click for details.' }));
  }

  it('shows the thread\'s output from main\'s totals, not the per-reply usage events', async () => {
    const getThreadUsage = window.groveBench.getThreadUsage as ReturnType<typeof vi.fn>;
    getThreadUsage.mockResolvedValueOnce({ spendUsd: 0, tokens: { input: 90_000, output: 12_300 } });
    await openContext();
    expect(getThreadUsage).toHaveBeenCalledWith(ACTIVE);
    await waitFor(() => expect(screen.getByText('Output, this thread').nextElementSibling).toHaveTextContent('12.3k'));
  });

  it('asks for the output again when a turn ends while it is open', async () => {
    const getThreadUsage = window.groveBench.getThreadUsage as ReturnType<typeof vi.fn>;
    getThreadUsage.mockResolvedValueOnce({ spendUsd: 0, tokens: { input: 90_000, output: 12_300 } });
    await openContext();
    const output = () => screen.getByText('Output, this thread').nextElementSibling;
    await waitFor(() => expect(output()).toHaveTextContent('12.3k'));

    getThreadUsage.mockResolvedValueOnce({ spendUsd: 0, tokens: { input: 120_000, output: 15_000 } });
    try {
      messageStore.messagesBySession[ACTIVE] = [{ kind: 'result', id: 'r-next', durationMs: 1000 } as any];
      await waitFor(() => expect(output()).toHaveTextContent('15.0k'));
    } finally {
      delete messageStore.messagesBySession[ACTIVE];
    }
  });

  it('says when the thread\'s output could not be read', async () => {
    (window.groveBench.getThreadUsage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('gone'));
    await openContext();
    await waitFor(() => expect(screen.getByText('Output, this thread').nextElementSibling).toHaveTextContent('unknown'));
  });

  it('labels the meter and says what context is', async () => {
    await openContext();
    expect(screen.getByRole('button', { name: 'Context 75% used. Click for details.' })).toHaveTextContent(/^Context\s*75%$/);
    expect(screen.getByText(/How much the agent can hold in mind at once/)).toBeTruthy();
  });

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

  it("doesn't offer to summarise for an agent that can't", async () => {
    claudeAgent(false);
    await openContext();
    expect(screen.queryByRole('button', { name: 'Summarise to free space' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start fresh…' })).toBeTruthy();
  });

  it('colours the whole used length, cached tokens included', () => {
    // Nearly all of it cached, as it is with prompt caching: the bar still
    // reads as 90% full (four of five blocks and part of the last), in the
    // full colour.
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: 2_000, cacheReadTokens: 170_000, cacheCreationTokens: 8_000 };
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });

    const blocks = [...getByTestId('context-bar').children] as HTMLElement[];
    expect(blocks.map((b) => b.dataset.block)).toEqual([...Array(4).fill('full'), 'part']);
    for (const b of blocks.slice(0, 4)) expect(b.className).toContain('bg-red-400');
    expect(screen.getByText('90%').className).toContain('text-red-400');
  });
});

describe('StatusBar PR', () => {
  function pr(over: Partial<PrInfo> = {}): PrInfo {
    return {
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      state: 'OPEN',
      title: 'Fix token refresh',
      reviewDecision: '',
      checks: { total: 2, passed: 2, failed: 0, pending: 0 },
      failingChecks: [],
      headSha: 'sha-1',
      headRefName: 'feat-a',
      baseRefName: 'main',
      ...over,
    };
  }

  // The PR popover flies in and out. jsdom has no Web Animations, so each
  // animation here finishes at once.
  const realAnimate = Element.prototype.animate;

  beforeEach(() => {
    prStore.clear(ACTIVE);
    store.prerequisites = { gh: { available: true } } as any;
    Element.prototype.animate = function () {
      const animation = { onfinish: null as null | (() => void), cancel() {}, currentTime: 0 };
      queueMicrotask(() => animation.onfinish?.());
      return animation as unknown as Animation;
    };
  });

  afterEach(() => {
    // Unmount first: clearing the store closes an open popover, and its
    // outro still needs the animate stub.
    cleanup();
    vi.mocked(window.groveBench.getPrs).mockReset();
    vi.mocked(window.groveBench.getGitSyncStatus).mockReset();
    vi.mocked(window.groveBench.push).mockReset();
    prStore.clear(ACTIVE);
    store.prerequisites = null;
    messageStore.isRunning = {};
    Element.prototype.animate = realAnimate;
  });

  /** The branch lozenge, once the bar has drawn it. */
  const lozenge = () => screen.getByTestId('branch');

  /** Render the active conversation with these PRs (primary first) and
   *  wait for the branch lozenge to know of them. */
  async function renderWithPrs(...prs: PrInfo[]) {
    vi.mocked(window.groveBench.getPrs).mockImplementation(async (id: string) => (id === ACTIVE ? prs : []));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await waitFor(() => expect(lozenge().getAttribute('title')).toContain(`PR #${prs[0].number}`));
    return lozenge();
  }

  /** Open the branch popup. */
  async function openBranch() {
    await fireEvent.click(lozenge());
    return screen.getByRole('dialog', { name: 'Branch' });
  }

  it('says where the branch is in words, not just with the dots', async () => {
    const branch = await renderWithPrs(pr({ checks: { total: 2, passed: 1, failed: 1, pending: 0 }, failingChecks: ['e2e'] }));
    expect(branch.getAttribute('title')).toContain('repo / feat-a: PR #42 open, checks: 1 of 2 failed');
    expect(branch).toHaveAccessibleName(/, something to do$/);
  });

  it('marks the lozenge green only when there is something to do', async () => {
    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 0, behind: 0 });
    const branch = await renderWithPrs(pr({ checks: { total: 2, passed: 1, failed: 0, pending: 1 } }));
    expect(branch.querySelector('.bg-primary')).toBeNull();
    // Checks running, nothing for you to do: the third dot moves.
    expect(branch.querySelectorAll('[aria-hidden="true"] > *')[2].className).toContain('animate-');

    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 2, behind: 0 });
    await prStore.refresh(ACTIVE, true);
    await waitFor(() => expect(lozenge().querySelector('.bg-primary')).not.toBeNull());
  });

  it('names each step in its popup', async () => {
    await renderWithPrs(pr({ reviewDecision: 'REVIEW_REQUIRED' }));
    const popup = await openBranch();
    const steps = within(within(popup).getByRole('list', { name: 'Steps to merged' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Push',
      'PR #42 open',
      'Checks 2 passed',
      'Review review required',
      'Merge',
    ]);
  });

  it('says in the tooltip when auto turns are on, since they are saved', async () => {
    prStore.setAuto(ACTIVE, { fixCi: true });
    const branch = await renderWithPrs(pr());
    expect(branch.getAttribute('title')).toContain('auto: fix CI');
  });

  it('closes the popup on Escape and hands focus back to the lozenge', async () => {
    const branch = await renderWithPrs(pr());
    await openBranch();
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    screen.getByRole('button', { name: 'Open ↗' }).focus();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open ↗' })).toBeNull());
    expect(branch.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(branch);
  });

  it('offers to create a PR with the agent or by hand, and waits for the turn to end', async () => {
    messageStore.isRunning = { [ACTIVE]: true };
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await waitFor(() => expect(lozenge()).toBeTruthy());
    await openBranch();

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create PR with agent' }).disabled).toBe(true);
    const manual = screen.getByRole<HTMLButtonElement>('button', { name: 'Create PR manually…' });
    expect(manual.disabled).toBe(true);
    expect(manual.getAttribute('title')).toMatch(/once the agent finishes its turn/);
  });

  it('switches branch from the popup, in its place', async () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await openBranch();
    await fireEvent.click(screen.getByRole('button', { name: 'Switch branch…' }));

    expect(screen.queryByRole('dialog', { name: 'Branch' })).toBeNull();
    expect(screen.getByPlaceholderText('Switch to a branch, or type a new name')).toBeInTheDocument();

    // A click on the lozenge puts the picker away rather than open the popup.
    await fireEvent.click(lozenge());
    await waitFor(() => expect(screen.queryByPlaceholderText('Switch to a branch, or type a new name')).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Branch' })).toBeNull();
  });

  it('clears the "new" chips once the popup is closed, but keeps a needs-human note', async () => {
    const branch = await renderWithPrs(pr({ checks: { total: 1, passed: 0, failed: 1, pending: 0 }, reviewDecision: 'CHANGES_REQUESTED' }));
    prStore.alertsBySession = {
      [ACTIVE]: [
        { kind: 'ci_failed', checks: ['e2e'], id: 1, prNumber: 42 },
        { kind: 'new_comments', count: 2, id: 2, prNumber: 42 },
        { kind: 'needs_human', reason: 'Auto-fix gave up', id: 3, prNumber: 42 },
      ],
    };
    await fireEvent.click(branch);
    expect(screen.getByText('2 new')).toBeTruthy();

    await fireEvent.click(branch);

    expect(prStore.getAlerts(ACTIVE)).toMatchObject([{ kind: 'needs_human' }]);
  });

  it('shows "review required" for an open PR waiting on reviewers', async () => {
    await renderWithPrs(pr({ reviewDecision: 'REVIEW_REQUIRED' }));
    await openBranch();
    expect(screen.getByText('Reviews')).toBeTruthy();
    expect(screen.getByText('required')).toBeTruthy();
  });

  it('offers no agent fixes or automation on a closed PR, and a way to start a new one', async () => {
    await renderWithPrs(pr({ state: 'CLOSED', checks: { total: 1, passed: 0, failed: 1, pending: 0 } }));
    await openBranch();

    expect(screen.queryByRole('button', { name: /fix with agent/ })).toBeNull();
    expect(screen.queryByText('Auto')).toBeNull();
    expect(screen.getByText('New PR')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'manually…' })).toBeTruthy();
    expect(lozenge().querySelector('.bg-primary')).toBeNull();
  });

  it('does not offer a new PR while one is open', async () => {
    await renderWithPrs(pr(), pr({ number: 38, state: 'MERGED' }));
    await openBranch();
    expect(screen.queryByText('New PR')).toBeNull();
  });

  it('colours other PRs by their health', async () => {
    await renderWithPrs(
      pr(),
      pr({ number: 70, title: 'Stacked', reviewDecision: 'CHANGES_REQUESTED', checks: null, baseRefName: 'release' }),
    );
    await openBranch();
    const row = screen.getByText('#70').closest('div')!;
    expect(row.querySelector('span')!.className).toContain('bg-amber-500');
    expect(screen.getByText('Other PRs in this thread')).toBeTruthy();
  });

  it('pushes from the popup, and drops a failed push once nothing is left to push', async () => {
    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 2, behind: 0 });
    vi.mocked(window.groveBench.push).mockRejectedValue(new Error('rejected: non-fast-forward'));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await waitFor(() => expect(lozenge().querySelector('.bg-primary')).not.toBeNull());
    await openBranch();
    await fireEvent.click(await screen.findByRole('button', { name: 'Push 2 commits' }));
    expect(await screen.findByTestId('push-error')).toHaveTextContent('rejected: non-fast-forward');

    // The agent (or a terminal) pushed it; the next poll sees nothing to push.
    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 0, behind: 0 });
    await prStore.refresh(ACTIVE, true);

    await waitFor(() => expect(screen.queryByTestId('push-error')).toBeNull());
    expect(lozenge().getAttribute('title')).not.toContain('push failed');
  });

  it('shows a push that failed in the Changes tab, with the error in the popup', async () => {
    vi.mocked(window.groveBench.push).mockRejectedValue(new Error('rejected: non-fast-forward'));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    // The Changes tab's "& Push" goes through the same store call.
    await prStore.push(ACTIVE).catch(() => {});

    await waitFor(() => expect(lozenge().getAttribute('title')).toContain('push failed'));
    expect(lozenge().querySelector('.bg-red-500')).not.toBeNull();
    await openBranch();
    expect(screen.getByTestId('push-error').textContent).toContain('rejected: non-fast-forward');

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('push-error')).toBeNull();
    expect(lozenge().getAttribute('title')).not.toContain('push failed');
  });

  it('retries a failed push from its popup: the new error on failure, gone on success', async () => {
    vi.mocked(window.groveBench.push).mockRejectedValueOnce(new Error('rejected: non-fast-forward'));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await prStore.push(ACTIVE).catch(() => {});
    await openBranch();

    vi.mocked(window.groveBench.push).mockRejectedValueOnce(new Error('could not read Username'));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('push-error').textContent).toContain('could not read Username'));

    vi.mocked(window.groveBench.push).mockResolvedValueOnce(undefined);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByTestId('push-error')).toBeNull());
    expect(window.groveBench.push).toHaveBeenCalledTimes(3);
  });
});

describe('StatusBar activity', () => {
  afterEach(() => {
    delete messageStore.messagesBySession[ACTIVE];
    messageStore.isRunning = {};
  });

  /** Open the activity lozenge's popup. */
  async function openActivity() {
    await fireEvent.click(screen.getByTestId('activity'));
    return screen.getByRole('dialog', { name: 'Activity' });
  }

  it('says it needs you while a permission prompt is open, even mid-turn, and fills amber', async () => {
    messageStore.setIsRunning(ACTIVE, true);
    messageStore.messagesBySession[ACTIVE] = [{ kind: 'permission', id: 'p1', resolved: false } as any];
    render(StatusBar, { props: { sessionId: ACTIVE } });
    const lozenge = screen.getByTestId('activity');
    expect(lozenge.textContent?.trim()).toBe('Needs you');
    expect(lozenge.className).toContain('bg-status-attention/10');

    await openActivity();
    await fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(messageStore.getActiveTab(ACTIVE)).toBe('activity');
    expect(screen.queryByRole('dialog', { name: 'Activity' })).toBeNull();
  });

  it('names the running tool, with its command in the popup', async () => {
    messageStore.setIsRunning(ACTIVE, true);
    vi.spyOn(messageStore, 'getActivity').mockReturnValue({ activity: 'tool_starting', toolName: 'Bash', elapsedSeconds: 12 });
    messageStore.messagesBySession[ACTIVE] = [
      { kind: 'tool_call', id: 't', toolName: 'Bash', toolUseId: 'tu1', toolInput: { command: 'npm test' }, pending: true } as any,
    ];
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.getByTestId('activity').textContent?.trim()).toBe('Bash');

    const popup = await openActivity();
    expect(within(popup).getByTestId('activity-now')).toHaveTextContent(/^Bash\s*12s$/);
    expect(within(popup).getByText('npm test')).toBeInTheDocument();
  });

  it('keeps one width whatever the word, so the bar does not shift', () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.getByTestId('activity')).toHaveClass('w-24', '@2xl:w-32');
  });

  describe('subagents', () => {
    const agentCall = {
      kind: 'tool_call', id: 'a', toolName: 'Agent', toolUseId: 'tu-agent', pending: false,
      toolInput: { description: 'Count failed runs', subagent_type: 'Explore' }, result: 'Async agent launched',
    } as any;
    const subagentBash = {
      kind: 'tool_call', id: 'b', toolName: 'Bash', toolUseId: 'tu-bash', toolInput: { command: 'node runs.mjs' }, pending: true, parentToolUseId: 'tu-agent',
    } as any;
    afterEach(() => {
      backgroundTaskStore.tasksBySession = {};
      subagentPanelStore.close();
    });

    it('says a subagent\'s tool is one, and opens its thread from the list', async () => {
      messageStore.messagesBySession[ACTIVE] = [agentCall, subagentBash];
      render(StatusBar, { props: { sessionId: ACTIVE } });
      expect(screen.getByTestId('activity').textContent?.trim()).toBe('Subagent');
      const popup = await openActivity();
      expect(within(popup).getByText('Subagent tools running')).toBeInTheDocument();

      const row = within(popup).getByRole('button', { name: /node runs\.mjs/ });
      expect(row).toHaveTextContent('in Explore');
      await fireEvent.click(row);
      expect(subagentPanelStore.isShowing(ACTIVE, 'tu-agent')).toBe(true);
      expect(screen.queryByRole('dialog', { name: 'Activity' })).toBeNull();
    });

    it('opens a background subagent\'s thread from its task, and leaves other tasks alone', async () => {
      messageStore.messagesBySession[ACTIVE] = [agentCall];
      const task = { description: '', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 } as const;
      backgroundTaskStore.tasksBySession = {
        [ACTIVE]: {
          bg1: { ...task, taskId: 'bg1', toolUseId: 'tu-agent', description: 'Count failed runs' },
          bg2: { ...task, taskId: 'bg2', toolUseId: 'tu-shell', description: 'npm run dev' },
        },
      };
      render(StatusBar, { props: { sessionId: ACTIVE } });
      expect(screen.getByTestId('activity').textContent?.trim()).toBe('Background');
      await openActivity();

      expect(screen.queryByRole('button', { name: /npm run dev/ })).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: /Count failed runs/ }));
      expect(subagentPanelStore.isShowing(ACTIVE, 'tu-agent')).toBe(true);
    });
  });

  it('goes back to the agent\'s state once answered', () => {
    messageStore.messagesBySession[ACTIVE] = [{ kind: 'permission', id: 'p1', resolved: true } as any];
    const { getByTestId } = render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(getByTestId('activity').textContent?.trim()).toBe('Ready');
  });
});

describe('StatusBar context popover closes on Escape', () => {
  afterEach(() => {
    delete messageStore.usageBySession[ACTIVE];
    delete messageStore.contextWindowBySession[ACTIVE];
  });

  it('closes the context popover without stopping anything else', async () => {
    claudeAgent();
    messageStore.contextWindowBySession[ACTIVE] = 200_000;
    messageStore.usageBySession[ACTIVE] = { inputTokens: 50_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(screen.getByRole('button', { name: /^Context 25% used/ }));
    expect(screen.queryByText('Summarise to free space')).not.toBeNull();

    const later = vi.fn();
    window.addEventListener('keydown', later);
    await fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', later);

    expect(screen.queryByText('Summarise to free space')).toBeNull();
    expect(later).not.toHaveBeenCalled();
    agentsStore.list = [];
    agentsStore.loaded = false;
  });
});

describe('StatusBar last turn', () => {
  afterEach(() => {
    delete messageStore.messagesBySession[ACTIVE];
    usageStore.byProvider = {};
  });

  function finishTurn(totalCostUsd: number) {
    messageStore.messagesBySession[ACTIVE] = [{ kind: 'result', id: 'r1', totalCostUsd, durationMs: 4200 } as any];
  }

  /** The last turn's figures, in the activity popup. */
  async function lastTurn() {
    if (!screen.queryByRole('dialog', { name: 'Activity' })) await fireEvent.click(screen.getByTestId('activity'));
    return screen.getByTestId('last-turn');
  }
  const figures = async () => (await lastTurn()).querySelector('dd')!.textContent?.trim();

  it('keeps the time and cost off the bar', () => {
    usageStore.byProvider = { 'claude-code': { available: false, windows: [], fetchedAt: Date.now() } };
    finishTurn(0.0423);
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.queryByTestId('last-turn')).toBeNull();
    expect(document.querySelector('[data-status-bar]')!.textContent).not.toContain('$');
  });

  it('shows the cost for an API key sign-in, rounded to cents', async () => {
    usageStore.byProvider = { 'claude-code': { available: false, windows: [], fetchedAt: Date.now() } };
    finishTurn(0.0423);
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(await figures()).toBe('4.2s · $0.04');
    expect((await lastTurn()).title).toContain('$0.0423 at list price');
  });

  it('leaves the cost out on a plan, which it is not billed against', async () => {
    usageStore.byProvider = { 'claude-code': { available: true, plan: 'max', windows: [], fetchedAt: Date.now() } };
    finishTurn(0.0423);
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(await figures()).toBe('4.2s');
  });

  it('waits to show a cost until it knows the sign-in, and asks', async () => {
    // Claude reports plan usage; nothing has fetched it yet.
    agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: { usage: true }, isDefault: true }];
    agentsStore.loaded = true;
    const refresh = vi.spyOn(usageStore, 'refresh').mockResolvedValue();
    try {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      expect(await figures()).not.toContain('$');
      expect(refresh).toHaveBeenCalledWith(ACTIVE);
    } finally {
      agentsStore.list = [];
      agentsStore.loaded = false;
    }
  });

  it('shows the cost for an agent that cannot report plan usage', async () => {
    agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true }];
    agentsStore.loaded = true;
    try {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      expect(await figures()).toContain('$0.04');
    } finally {
      agentsStore.list = [];
      agentsStore.loaded = false;
    }
  });

  it('shows a free turn as $0.00, not under a cent', async () => {
    usageStore.byProvider = { 'claude-code': { available: false, windows: [], fetchedAt: Date.now() } };
    finishTurn(0);
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(await figures()).toContain('$0.00');
  });

  it('says when a turn cost under a cent', async () => {
    usageStore.byProvider = { 'claude-code': { available: false, windows: [], fetchedAt: Date.now() } };
    finishTurn(0.003);
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(await figures()).toContain('<$0.01');
  });

  describe('usage, in the activity popup', () => {
    const api = () => window.groveBench as unknown as { getThreadUsage: ReturnType<typeof vi.fn>; getDailySpend: ReturnType<typeof vi.fn> };
    const usage = (spendUsd: number, input = 0, output = 0): ThreadUsage => ({ spendUsd, tokens: { input, output } });
    const row = (name: string) => within(screen.getByRole('dialog', { name: 'Activity' })).getByText(name).nextElementSibling;
    /** The lozenge opens the popup and, clicked again, closes it. */
    const toggle = () => fireEvent.click(screen.getByTestId('activity'));

    beforeEach(() => {
      usageStore.byProvider = { 'claude-code': { available: false, windows: [], fetchedAt: Date.now() } };
      api().getThreadUsage.mockResolvedValue(usage(1.234));
      api().getDailySpend.mockResolvedValue(6.3);
    });
    afterEach(() => {
      api().getThreadUsage.mockReset().mockResolvedValue(usage(0));
      api().getDailySpend.mockReset().mockResolvedValue(0);
    });

    it('shows the thread\'s and today\'s totals with the last turn\'s cost', async () => {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();

      expect(api().getThreadUsage).toHaveBeenCalledWith(ACTIVE);
      await waitFor(() => expect(row('This thread')).toHaveTextContent('$1.23'));
      expect(row('Today, all threads')).toHaveTextContent('$6.30');
      expect(row('Last turn')).toHaveTextContent('$0.04');
    });

    it('asks again when a turn ends while it is open', async () => {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('This thread')).toHaveTextContent('$1.23'));

      api().getThreadUsage.mockResolvedValue(usage(2));
      messageStore.messagesBySession[ACTIVE] = [
        ...messageStore.messagesBySession[ACTIVE],
        { kind: 'result', id: 'r2', totalCostUsd: 0.5, durationMs: 1000 } as any,
      ];
      await waitFor(() => expect(row('This thread')).toHaveTextContent('$2.00'));
      expect(row('Last turn')).toHaveTextContent('$0.50');
    });

    it('says which total could not be read, and still shows the other', async () => {
      api().getThreadUsage.mockRejectedValue(new Error('gone'));
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('This thread')).toHaveTextContent('unknown'));
      expect(row('Today, all threads')).toHaveTextContent('$6.30');
    });

    it('drops a total it could not read again, rather than show the old one', async () => {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('This thread')).toHaveTextContent('$1.23'));

      api().getThreadUsage.mockRejectedValue(new Error('gone'));
      messageStore.messagesBySession[ACTIVE] = [
        ...messageStore.messagesBySession[ACTIVE],
        { kind: 'result', id: 'r2', totalCostUsd: 0.5, durationMs: 1000 } as any,
      ];
      await waitFor(() => expect(row('This thread')).toHaveTextContent('unknown'));
    });

    it('ignores an answer that arrives after the popup was closed', async () => {
      let answer!: (usage: ThreadUsage) => void;
      api().getThreadUsage.mockReturnValue(new Promise<ThreadUsage>((resolve) => { answer = resolve; }));
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await toggle();
      answer(usage(9));
      await Promise.resolve();

      api().getThreadUsage.mockReturnValue(new Promise(() => {}));
      await toggle();
      expect(row('This thread')).toHaveTextContent('…');
    });

    it('asks afresh each time it opens, without showing the last answers meanwhile', async () => {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('This thread')).toHaveTextContent('$1.23'));
      await toggle();

      api().getThreadUsage.mockReturnValue(new Promise(() => {}));
      await toggle();
      expect(row('This thread')).toHaveTextContent('…');
    });

    it('links to Limits & alerts in Settings', async () => {
      const openAt = vi.spyOn(settingsStore, 'openAt').mockImplementation(() => {});
      try {
        finishTurn(0.0423);
        render(StatusBar, { props: { sessionId: ACTIVE } });
        await toggle();
        await fireEvent.click(screen.getByRole('button', { name: 'Limits & alerts' }));
        expect(openAt).toHaveBeenCalledWith('limits');
        expect(screen.queryByRole('dialog', { name: 'Activity' })).toBeNull();
      } finally {
        openAt.mockRestore();
      }
    });

    it('shows the thread\'s tokens next to its spend', async () => {
      api().getThreadUsage.mockResolvedValue(usage(1.234, 1_240_000, 45_300));
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('Tokens in, this thread')).toHaveTextContent('1.2M'));
      expect(row('Tokens out, this thread')).toHaveTextContent('45.3k');
    });

    it('says when the thread\'s agent has reported no tokens', async () => {
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();
      await waitFor(() => expect(row('Tokens, this thread')).toHaveTextContent('none reported'));
      expect(screen.queryByText('Tokens in, this thread')).toBeNull();
    });

    it('shows tokens without dollars on a plan, where the cost is left out', async () => {
      usageStore.byProvider = { 'claude-code': { available: true, plan: 'max', windows: [], fetchedAt: Date.now() } };
      api().getThreadUsage.mockResolvedValue(usage(1.234, 5000, 700));
      finishTurn(0.0423);
      render(StatusBar, { props: { sessionId: ACTIVE } });
      await toggle();

      await waitFor(() => expect(row('Tokens in, this thread')).toHaveTextContent('5.0k'));
      expect(row('Tokens out, this thread')).toHaveTextContent('700');
      const dialog = within(screen.getByRole('dialog', { name: 'Activity' }));
      expect(dialog.queryByText('This thread')).toBeNull();
      expect(dialog.queryByText(/\$/)).toBeNull();
      expect(api().getDailySpend).not.toHaveBeenCalled();
    });
  });
});

// The agent may have started it while you were reading the thread.
describe('StatusBar: a merge or rebase stopped part way', () => {
  afterEach(() => gitStatusStore.clear(ACTIVE));

  it('shows it on the branch lozenge, and opens the Changes tab from the popup to finish it', async () => {
    const refresh = vi.spyOn(gitStatusStore, 'refresh').mockResolvedValue(undefined);
    gitStatusStore.statusBySession = { ...gitStatusStore.statusBySession, [ACTIVE]: { entries: [], operation: { kind: 'rebase', branch: 'feat-a', incoming: 'main', step: 1, total: 2 } } };
    render(StatusBar, { props: { sessionId: ACTIVE } });

    const lozenge = screen.getByTestId('branch');
    expect(lozenge).toHaveTextContent('rebasing 1/2');
    expect(lozenge.title).toContain('Rebasing feat-a onto main, step 1 of 2 stopped part way');
    await fireEvent.click(lozenge);
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Branch' })).getByRole('button', { name: /stopped part way/ }));
    expect(messageStore.getActiveTab(ACTIVE)).toBe('changes');
    expect(refresh).toHaveBeenCalledWith(ACTIVE);
    expect(screen.queryByRole('dialog', { name: 'Branch' })).toBeNull();
    refresh.mockRestore();
  });

  it('shows nothing when none is under way', () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect(screen.getByTestId('branch')).not.toHaveTextContent(/rebasing|merging/);
  });
});
