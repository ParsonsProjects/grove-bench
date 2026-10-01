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
import { CONTROL_IDS } from '../../shared/types.js';
import { TAB_BY_KEY, TAB_LABELS } from '../lib/keyboard-shortcuts.js';
import type { PrInfo } from '../../shared/types.js';

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

describe('StatusBar Keys popover', () => {
  it('lists each tab under the key that switches to it', async () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));

    const popover = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const [key, tab] of Object.entries(TAB_BY_KEY)) {
      const row = within(popover).getByText(`${TAB_LABELS[tab]} tab`).closest('div')!;
      expect(row).toHaveTextContent(`Alt+${key}`);
    }
    expect(within(popover).getByText('Settings').closest('div')).toHaveTextContent('Ctrl+,');
  });

  it('closes on Escape, with focus back on its button', async () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    const button = screen.getByRole('button', { name: 'Keys' });
    // A real click focuses the button; jsdom's doesn't.
    button.focus();
    await fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(button);
  });

  it('lets Escape through when focus is elsewhere, such as a dialog opened over it', async () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    const reached = vi.fn();
    document.addEventListener('keydown', reached);

    await fireEvent.keyDown(elsewhere, { key: 'Escape' });

    expect(reached).toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    document.removeEventListener('keydown', reached);
    elsewhere.remove();
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
    expect(getByRole('button', { name: /^Thread view:/ }).nextElementSibling).toBe(warning);
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
    await fireEvent.click(screen.getByRole('button', { name: 'Context 75% used. Click for details.' }));
  }

  it('labels the meter and says what context is', async () => {
    await openContext();
    expect(screen.getByText('Context 75%')).toBeTruthy();
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

  /** Render the active conversation with these PRs (primary first) and
   *  wait for the pill. */
  async function renderWithPrs(...prs: PrInfo[]) {
    vi.mocked(window.groveBench.getPrs).mockImplementation(async (id: string) => (id === ACTIVE ? prs : []));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    return screen.findByRole('button', { name: new RegExp(`^PR #${prs[0].number}`) });
  }

  it('says the PR health in words, not just with the dot colour', async () => {
    const pill = await renderWithPrs(pr({ checks: { total: 2, passed: 1, failed: 1, pending: 0 }, failingChecks: ['e2e'] }));
    expect(pill.getAttribute('title')).toContain('PR #42: CI failing');
  });

  it('says in the tooltip when auto turns are on, since they are saved', async () => {
    prStore.setAuto(ACTIVE, { fixCi: true });
    const pill = await renderWithPrs(pr());
    expect(pill.getAttribute('title')).toContain('auto: fix CI');
  });

  it('closes the popover on Escape and hands focus back to the pill', async () => {
    const pill = await renderWithPrs(pr());
    await fireEvent.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    screen.getByRole('button', { name: 'Open ↗' }).focus();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open ↗' })).toBeNull());
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pill);
  });

  it('closes the Create PR menu on Escape', async () => {
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Create PR options' }));
    expect(screen.getByRole('button', { name: 'Create manually…' })).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Create manually…' })).toBeNull();
  });

  it('waits for the turn to end before creating a PR by hand, like the Create PR link', async () => {
    messageStore.isRunning = { [ACTIVE]: true };
    render(StatusBar, { props: { sessionId: ACTIVE } });
    expect((await screen.findByRole('button', { name: 'Create PR' }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Create PR options' }));

    const manual = screen.getByRole('button', { name: 'Create manually…' }) as HTMLButtonElement;
    expect(manual.disabled).toBe(true);
    expect(manual.getAttribute('title')).toMatch(/once the agent finishes its turn/);
  });

  it('clears the "new" chips once the popover is closed, but keeps a needs-human note', async () => {
    const pill = await renderWithPrs(pr({ checks: { total: 1, passed: 0, failed: 1, pending: 0 }, reviewDecision: 'CHANGES_REQUESTED' }));
    prStore.alertsBySession = {
      [ACTIVE]: [
        { kind: 'ci_failed', checks: ['e2e'], id: 1, prNumber: 42 },
        { kind: 'new_comments', count: 2, id: 2, prNumber: 42 },
        { kind: 'needs_human', reason: 'Auto-fix gave up', id: 3, prNumber: 42 },
      ],
    };
    await fireEvent.click(pill);
    expect(screen.getByText('2 new')).toBeTruthy();

    await fireEvent.click(pill);

    expect(prStore.getAlerts(ACTIVE)).toMatchObject([{ kind: 'needs_human' }]);
  });

  it('shows "review required" for an open PR waiting on reviewers', async () => {
    await fireEvent.click(await renderWithPrs(pr({ reviewDecision: 'REVIEW_REQUIRED' })));
    expect(screen.getByText('Reviews')).toBeTruthy();
    expect(screen.getByText('required')).toBeTruthy();
  });

  it('offers no agent fixes or automation on a closed PR, and a way to start a new one', async () => {
    await fireEvent.click(await renderWithPrs(pr({ state: 'CLOSED', checks: { total: 1, passed: 0, failed: 1, pending: 0 } })));

    expect(screen.queryByRole('button', { name: /fix with agent/ })).toBeNull();
    expect(screen.queryByText('Auto')).toBeNull();
    expect(screen.getByText('New PR')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'manually…' })).toBeTruthy();
  });

  it('does not offer a new PR while one is open', async () => {
    await fireEvent.click(await renderWithPrs(pr(), pr({ number: 38, state: 'MERGED' })));
    expect(screen.queryByText('New PR')).toBeNull();
  });

  it('colours other PRs the same way as the pill', async () => {
    await fireEvent.click(await renderWithPrs(
      pr(),
      pr({ number: 70, title: 'Stacked', reviewDecision: 'CHANGES_REQUESTED', checks: null, baseRefName: 'release' }),
    ));
    const row = screen.getByText('#70').closest('div')!;
    expect(row.querySelector('span')!.className).toContain('bg-orange-400');
    expect(screen.getByText('Other PRs in this conversation')).toBeTruthy();
  });

  it('drops a "push failed" note once nothing is left to push', async () => {
    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 2, behind: 0 });
    vi.mocked(window.groveBench.push).mockRejectedValue(new Error('rejected: non-fast-forward'));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    await fireEvent.click(await screen.findByRole('button', { name: '↑2' }));
    expect(await screen.findByText('push failed')).toBeTruthy();

    // The agent (or a terminal) pushed it; the next poll sees nothing to push.
    vi.mocked(window.groveBench.getGitSyncStatus).mockResolvedValue({ upstream: 'origin/feat-a', ahead: 0, behind: 0 });
    await prStore.refresh(ACTIVE, true);

    await waitFor(() => expect(screen.queryByText('push failed')).toBeNull());
  });

  it('shows a push that failed in the Changes tab, and dismisses it on click', async () => {
    vi.mocked(window.groveBench.push).mockRejectedValue(new Error('rejected: non-fast-forward'));
    render(StatusBar, { props: { sessionId: ACTIVE } });
    // The Changes tab's "& Push" goes through the same store call.
    await prStore.push(ACTIVE).catch(() => {});

    const note = await screen.findByRole('button', { name: 'push failed' });
    expect(note.getAttribute('title')).toContain('rejected: non-fast-forward');
    await fireEvent.click(note);

    expect(screen.queryByText('push failed')).toBeNull();
  });
});
