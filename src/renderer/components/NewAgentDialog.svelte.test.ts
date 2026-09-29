import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import NewAgentDialog from './NewAgentDialog.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import type { AgentPrerequisiteStatus, AgentSummary, OpenPrSummary, PrerequisiteStatus } from '../../shared/types.js';

const claude: AgentSummary = { id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true };
const codex: AgentSummary = { id: 'codex', displayName: 'Codex', capabilities: {} };

const agentStatus = (authenticated: boolean, label: string, saved = false): AgentPrerequisiteStatus => ({
  available: true,
  authenticated,
  apiKey: { label, helpUrl: 'https://example.com/keys', saved, canStore: true },
});

function status(claudeIn: boolean, codexIn?: boolean): PrerequisiteStatus {
  return {
    git: { available: true, meetsMinimum: true },
    agents: {
      'claude-code': agentStatus(claudeIn, 'Anthropic API key'),
      ...(codexIn === undefined ? {} : { codex: agentStatus(codexIn, 'OpenAI API key') }),
    },
  };
}

const signedOut = status(false);
const signedIn = status(true);

// jsdom lacks scrollIntoView, which bits-ui calls on the highlighted option.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

// jsdom has no pointer capture, so open the bits-ui Select from the keyboard.
async function pickAgent(name: string) {
  const trigger = screen.getByRole('button', { name: 'Agent' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  const option = await screen.findByRole('option', { name });
  option.focus();
  await fireEvent.pointerMove(option);
  await fireEvent.keyDown(document.activeElement ?? option, { key: 'Enter' });
  await waitFor(() => expect(trigger).toHaveTextContent(name));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.prerequisites = null;
  agentsStore.list = [claude];
  agentsStore.loaded = true;
  mockGroveBench.checkPrerequisites.mockResolvedValue(signedOut);
  mockGroveBench.setApiKey.mockImplementation(async (adapterId: string) => {
    const current = store.prerequisites ?? signedOut;
    return { ...current, agents: { ...current.agents, [adapterId]: { ...current.agents[adapterId], apiKey: { ...current.agents[adapterId].apiKey!, saved: true } } } };
  });
  (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession = vi.fn().mockResolvedValue({ id: 'new', branch: 'main', agentType: 'claude-code' });
});

afterEach(() => {
  cleanup();
  store.repos = [];
  store.sessions = [];
  store.prerequisites = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('NewAgentDialog credentials step', () => {
  it('goes straight to the form when the agent is signed in', () => {
    store.prerequisites = signedIn;
    render(NewAgentDialog, { onclose: vi.fn() });

    expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument();
    expect(mockGroveBench.checkPrerequisites).not.toHaveBeenCalled();
  });

  it('re-checks a cached signed-out state before asking for a key', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    render(NewAgentDialog, { onclose: vi.fn() });

    await waitFor(() => expect(mockGroveBench.checkPrerequisites).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument());
  });

  it('asks for a key when there are no credentials, then shows the form once saved', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });

    const input = await screen.findByLabelText('Anthropic API key');
    expect(screen.queryByRole('button', { name: 'New work' })).not.toBeInTheDocument();

    await fireEvent.input(input, { target: { value: 'sk-test-123' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('claude-code', 'sk-test-123');
    await waitFor(() => expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument());
  });

  it('shows the save error and stays on the key step', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.setApiKey.mockRejectedValueOnce(
      new Error("Error invoking remote method 'credentials:setApiKey': Error: An API key cannot contain spaces."),
    );
    render(NewAgentDialog, { onclose: vi.fn() });

    const input = await screen.findByLabelText('Anthropic API key');
    await fireEvent.input(input, { target: { value: 'bad key' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An API key cannot contain spaces.');
    expect(screen.queryByRole('button', { name: 'New work' })).not.toBeInTheDocument();
  });

  it('lets the user re-check after signing in with the CLI', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });
    await screen.findByLabelText('Anthropic API key');

    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    await fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument());
  });
});

describe('NewAgentDialog agent picker', () => {
  it('is hidden when only one agent is registered', () => {
    store.prerequisites = signedIn;
    render(NewAgentDialog, { onclose: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument();
  });

  it('starts on the default agent and asks for the picked agent\'s own key', async () => {
    agentsStore.list = [claude, codex];
    store.prerequisites = status(true, false);
    mockGroveBench.checkPrerequisites.mockResolvedValue(status(true, false));
    render(NewAgentDialog, { onclose: vi.fn() });

    expect(screen.getByRole('button', { name: 'Agent' })).toHaveTextContent('Claude Agent');
    expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument();

    await pickAgent('Codex');

    const input = await screen.findByLabelText('OpenAI API key');
    expect(screen.queryByRole('button', { name: 'New work' })).not.toBeInTheDocument();
    await fireEvent.input(input, { target: { value: 'sk-openai' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('codex', 'sk-openai');
    await waitFor(() => expect(screen.getByRole('button', { name: 'New work' })).toBeInTheDocument());
  });

  it('starts the conversation on the picked agent', async () => {
    agentsStore.list = [claude, codex];
    store.prerequisites = status(true, true);
    const createSession = (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
    createSession.mockResolvedValue({ id: 'new', branch: 'main', agentType: 'codex' });
    render(NewAgentDialog, { onclose: vi.fn() });

    await pickAgent('Codex');
    await fireEvent.click(await screen.findByRole('button', { name: 'Options' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Work in the project folder' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ adapterType: 'codex', direct: true })));
    expect(store.sessions.find((s) => s.id === 'new')?.agentType).toBe('codex');
    store.sessions = [];
  });
});

function createSessionMock() {
  return (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
}

const pr = (over: Partial<OpenPrSummary>): OpenPrSummary => ({
  number: 1, title: 'A PR', headRefName: 'feat/a', author: 'sam', isDraft: false, isCrossRepository: false, url: '', ...over,
});

describe('NewAgentDialog new work', () => {
  beforeEach(() => {
    store.prerequisites = signedIn;
    createSessionMock().mockResolvedValue({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
  });

  it('starts without a branch name and sends the message as the first turn', async () => {
    const addUserMessage = vi.spyOn(messageStore, 'addUserMessage');
    render(NewAgentDialog, { onclose: vi.fn() });

    const box = screen.getByLabelText('What should the agent work on?');
    await fireEvent.input(box, { target: { value: 'Fix API-12 login crash' } });
    await fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/one', branchName: '' })));
    const opts = createSessionMock().mock.calls[0][0];
    expect(opts.direct).toBeUndefined();
    expect(opts.useExisting).toBeUndefined();
    await waitFor(() => expect(mockGroveBench.sendMessage).toHaveBeenCalledWith('new1', 'Fix API-12 login crash'));
    expect(addUserMessage).toHaveBeenCalledWith('new1', 'Fix API-12 login crash');
    // The row is named from the message until the automatic name arrives.
    expect(store.sessions.find((s) => s.id === 'new1')?.displayName).toBeTruthy();
    addUserMessage.mockRestore();
  });

  it('keeps Shift+Enter as a new line', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    const box = screen.getByLabelText('What should the agent work on?');
    await fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('can start with no message, sending nothing', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
  });

  it('uses a branch name typed under Options', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    await fireEvent.input(screen.getByLabelText('Branch name'), { target: { value: 'feat/API-12-login' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'feat/API-12-login' })));
  });
});

describe('NewAgentDialog existing branch', () => {
  beforeEach(() => {
    store.prerequisites = signedIn;
    agentsStore.list = [{ ...claude, capabilities: { permissionModes: true } }];
    mockGroveBench.listBranches.mockResolvedValue(['main', 'feat/a', 'fix/b', 'taken']);
    mockGroveBench.listOpenPrs.mockResolvedValue([
      pr({ number: 7, title: 'Add login', headRefName: 'feat/a' }),
      pr({ number: 8, title: 'From a fork', headRefName: 'patch-1', isCrossRepository: true }),
    ]);
    store.sessions = [{ id: 'old', branch: 'taken', repoPath: '/repo/one', status: 'running' }];
    createSessionMock().mockResolvedValue({ id: 'rev1', branch: 'feat/a', agentType: 'claude-code' });
  });

  it('lists open PRs and the branches not already covered or in use', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Existing branch' }));

    expect(await screen.findByRole('button', { name: /#7 Add login/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /From a fork/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 pull request from a fork is/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fix/b' })).toBeInTheDocument();
    // feat/a shows as its PR, and "taken" is checked out by another conversation.
    expect(screen.queryByRole('button', { name: 'feat/a' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'taken' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('opens a PR in Plan mode by default', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Existing branch' }));
    await fireEvent.click(await screen.findByRole('button', { name: /#7 Add login/ }));

    expect(screen.getByRole('checkbox', { name: 'Start in Plan mode' })).toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({
      branchName: 'feat/a', useExisting: true, permissionMode: 'plan',
    })));
  });

  it('opens a plain branch in the default mode', async () => {
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Existing branch' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'fix/b' }));

    expect(screen.getByRole('checkbox', { name: 'Start in Plan mode' })).not.toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
    const opts = createSessionMock().mock.calls[0][0];
    expect(opts).toMatchObject({ branchName: 'fix/b', useExisting: true });
    expect(opts.permissionMode).toBeUndefined();
  });

  it('keeps listing branches when PRs cannot be listed', async () => {
    mockGroveBench.listOpenPrs.mockRejectedValue(new Error('gh not signed in'));
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Existing branch' }));

    expect(await screen.findByText(/Pull requests could not be listed/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'feat/a' })).toBeInTheDocument();
  });

  it('hides the Plan mode choice for agents without modes', async () => {
    agentsStore.list = [claude];
    render(NewAgentDialog, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Existing branch' }));
    await fireEvent.click(await screen.findByRole('button', { name: /#7 Add login/ }));
    expect(screen.queryByRole('checkbox', { name: 'Start in Plan mode' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
    expect(createSessionMock().mock.calls[0][0].permissionMode).toBeUndefined();
  });
});
