import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import WorkspacePane from './WorkspacePane.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';

const agents = { 'claude-code': { available: true, authenticated: true } };

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/notes'];
  store.sessions = [{ id: 'n1', branch: '', repoPath: '/notes', status: 'running', direct: true, noGit: true }] as any;
  store.activeSessionId = 'n1';
  messageStore.setActiveTab('n1', 'changes');
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.prerequisites = null;
  settingsStore.current.groveCharacters = true;
  messageStore.setIsRunning('n1', false);
  messageStore.destroyAllSessions();
  gitStatusStore.statusBySession = {};
});

describe('WorkspacePane in a conversation without git', () => {
  it('says why the Changes tab is empty, and loads no git status', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    expect(await screen.findByText('Changes needs git')).toBeInTheDocument();
    expect(screen.getByText(/This conversation runs without git, so there is nothing to compare/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();
  });

  it('warns in the Changes tab when git is not installed', async () => {
    store.prerequisites = { git: { available: false }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent("Git isn't installed.");
    expect(screen.getByRole('button', { name: 'Download Git' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeInTheDocument();
  });

  it("puts the conversation's agent on its bench above the message, typing while it works", async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    await screen.findByText('Changes needs git');
    // One on Changes, one on the hidden Checkpoints tab.
    expect(screen.getAllByRole('img', { name: 'Ready' })).toHaveLength(2);

    messageStore.setIsRunning('n1', true);
    expect(await screen.findAllByRole('img', { name: 'Working' })).toHaveLength(2);
  });

  it('shows only the message when grove characters are off', async () => {
    settingsStore.current.groveCharacters = false;
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    await screen.findByText('Changes needs git');
    expect(screen.queryByRole('img', { name: 'Ready' })).not.toBeInTheDocument();
  });

  it('puts the same agent on its bench in the Checkpoints tab', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    messageStore.setActiveTab('n1', 'checkpoints');
    render(WorkspacePane, { sessionId: 'n1' });
    await screen.findByText('Checkpoints needs git');
    expect(screen.getByText(/This conversation runs without git, so no checkpoints are saved/)).toBeInTheDocument();
    // One on Checkpoints, one on the hidden Changes tab.
    expect(screen.getAllByRole('img', { name: 'Ready' })).toHaveLength(2);
    expect(mockGroveBench.listCheckpoints).not.toHaveBeenCalled();
    // Each tab's scene has its own props.
    expect(document.querySelectorAll('[data-scenery="flag"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-scenery="watering-can"]')).toHaveLength(1);
  });

  it('calls the chat tab Thread, and points back to it from other tabs', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    messageStore.setActiveTab('n1', 'checkpoints');
    render(WorkspacePane, { sessionId: 'n1' });
    expect(await screen.findByRole('button', { name: /^Thread\s+Alt\+1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Activity/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to Thread to send messages (Alt+1)' })).toBeInTheDocument();
  });
});

describe('WorkspacePane thread view picker', () => {
  // jsdom lacks scrollIntoView, which bits-ui calls on the highlighted option.
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};

  beforeEach(() => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    messageStore.setActiveTab('n1', 'activity');
  });

  it('sits on the Thread tab only while it is open', async () => {
    render(WorkspacePane, { sessionId: 'n1' });
    expect(await screen.findByRole('button', { name: /^Thread view: / })).toBeInTheDocument();

    messageStore.setActiveTab('n1', 'changes');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Thread view: / })).toBeNull());
  });

  it('switches the view from its list', async () => {
    messageStore.setViewMode('n1', 'summary');
    render(WorkspacePane, { sessionId: 'n1' });
    const trigger = await screen.findByRole('button', { name: /^Thread view: Summary/ });

    // jsdom has no pointer capture, so pick from the keyboard.
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: /^Focus/ });
    option.focus();
    await fireEvent.pointerMove(option);
    await fireEvent.keyDown(document.activeElement ?? option, { key: 'Enter' });

    await waitFor(() => expect(messageStore.getViewMode('n1')).toBe('focus'));
    expect(screen.getByRole('button', { name: /^Thread view: Focus/ })).toBeInTheDocument();
  });
});

const SID = 'pane-session';

describe('WorkspacePane tabs', () => {
  it('loads the Changes tab on its first visit', async () => {
    store.sessions = [{ id: SID, branch: 'feat', repoPath: '/repo', status: 'running' }] as never;
    store.activeSessionId = SID;
    gitStatusStore.statusBySession = { [SID]: { entries: [] } };
    messageStore.messagesBySession = { [SID]: [] };
    render(WorkspacePane, { sessionId: SID });
    expect(screen.queryByText('Working tree clean')).toBeNull();

    messageStore.setActiveTab(SID, 'changes');

    expect(await screen.findByText('Working tree clean')).toBeInTheDocument();
  });
});

describe('WorkspacePane load timing', () => {
  it('reports how long fetching, replaying and first drawing the history took', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    await waitFor(() => expect(mockGroveBench.reportTiming).toHaveBeenCalled());
    const [report] = mockGroveBench.reportTiming.mock.calls[0] as [{ label: string; sessionId: string; steps: { name: string }[]; detail: string }];
    expect(report.label).toBe('conversation view');
    expect(report.sessionId).toBe('n1');
    expect(report.steps.map((s) => s.name)).toEqual(['history fetch', 'replay', 'first draw']);
    expect(report.detail).toMatch(/^\d+ events, shown$/);
  });

  it('says when loading the history failed', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    mockGroveBench.getEventHistoryPage.mockRejectedValueOnce(new Error('gone'));
    render(WorkspacePane, { sessionId: 'n1' });
    await waitFor(() => expect(mockGroveBench.reportTiming).toHaveBeenCalled());
    const [report] = mockGroveBench.reportTiming.mock.calls[0] as [{ detail: string }];
    expect(report.detail).toBe('history failed, shown');
  });

  it('times no first draw while the window is minimized', async () => {
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    render(WorkspacePane, { sessionId: 'n1' });
    await waitFor(() => expect(mockGroveBench.reportTiming).toHaveBeenCalled());
    const [report] = mockGroveBench.reportTiming.mock.calls[0] as [{ steps: { name: string }[]; detail: string }];
    expect(report.steps.map((s) => s.name)).toEqual(['history fetch', 'replay']);
    expect(report.detail).toMatch(/, window minimized$/);
    hidden.mockRestore();
  });
});

describe('WorkspacePane loading a new conversation', () => {
  it("shows the first message once when it arrives live while the history loads (it's in the page too)", async () => {
    store.sessions = [{ id: SID, branch: 'grove/x', repoPath: '/repo', status: 'running' }] as never;
    store.activeSessionId = SID;
    gitStatusStore.statusBySession = { [SID]: { entries: [] } };
    let live: ((event: unknown) => void) | undefined;
    mockGroveBench.onAgentEvent.mockImplementation(((_id: string, cb: (event: unknown) => void) => {
      live = cb;
      return vi.fn();
    }) as never);
    const first = [
      { type: 'status', message: 'Creating worktree…' },
      { type: 'status', message: 'Starting agent…' },
      { type: 'status', message: 'Connecting to Claude Agent' },
      { type: 'user_message', text: 'Add a hello world test', uuid: 'u1' },
    ];
    const later = { type: 'status', message: 'Connected to claude-opus' };
    type Page = { events: unknown[]; totalCount: number; startIndex: number };
    let answerPage: (page: Page) => void = () => {};
    mockGroveBench.getEventHistoryPage.mockImplementationOnce((() => new Promise<Page>((r) => { answerPage = r; })) as never);

    render(WorkspacePane, { sessionId: SID });
    await waitFor(() => expect(live).toBeDefined());
    // While the page is on its way: the last three steps arrive live...
    for (const event of first.slice(1)) live!(event);
    // ...and the page, read after main logged them, has all four.
    answerPage({ events: first, totalCount: first.length, startIndex: 0 });
    await waitFor(() => expect(messageStore.isHistoryLoaded(SID)).toBe(true));
    live!(later);

    const texts = messageStore.getMessages(SID).map((m) => ('text' in m ? m.text : m.kind));
    expect(texts).toEqual([
      'Creating worktree…', 'Starting agent…', 'Connecting to Claude Agent', 'Add a hello world test', 'Connected to claude-opus',
    ]);
  });
});
