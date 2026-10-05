import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import DraftPane from './DraftPane.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { AgentPrerequisiteStatus, AgentSummary, PrerequisiteStatus } from '../../shared/types.js';

const claude: AgentSummary = { id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true };
const codex: AgentSummary = { id: 'codex', displayName: 'Codex', capabilities: {} };

const agentStatus = (authenticated: boolean, label: string): AgentPrerequisiteStatus => ({
  available: true,
  authenticated,
  apiKey: { label, helpUrl: 'https://example.com/keys', saved: false, canStore: true },
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

function createSessionMock() {
  return (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.sessions = [];
  store.activeSessionId = null;
  store.prerequisites = status(true);
  agentsStore.list = [claude];
  agentsStore.loaded = true;
  mockGroveBench.checkPrerequisites.mockResolvedValue(status(false));
  mockGroveBench.getModels.mockResolvedValue([{ id: 'opus', label: 'Opus' }]);
  mockGroveBench.getAdapterControls.mockResolvedValue([]);
  (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession = vi.fn()
    .mockResolvedValue({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
});

afterEach(() => {
  cleanup();
  draftStore.discard();
  store.repos = [];
  store.sessions = [];
  store.prerequisites = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('DraftPane', () => {
  it('focuses the message box and explains what starting will do', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByText(/new branch from main, in a separate copy/)).toBeInTheDocument();
  });

  it('says in words which mode the conversation will start in', async () => {
    mockGroveBench.getAdapterControls.mockResolvedValue([
      { id: 'permissionMode', label: 'Mode', default: 'default', options: [
        { value: 'default', label: 'Ask', description: 'Check with you before each edit or command' },
      ] },
    ]);
    draftStore.discard();
    draftStore.open('/repo/one');
    await settle();
    render(DraftPane);
    expect(await screen.findByText(/Check with you before each edit or command\./)).toHaveTextContent('Mode: Ask.');
  });

  it('starts on Enter and sends the message', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.input(box, { target: { value: 'Fix API-12 login crash' } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
    await waitFor(() => expect(mockGroveBench.sendMessage).toHaveBeenCalledWith('new1', 'Fix API-12 login crash'));
  });

  it('keeps Shift+Enter as a new line', async () => {
    render(DraftPane);
    await fireEvent.keyDown(screen.getByLabelText('First message'), { key: 'Enter', shiftKey: true });
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('shows a failed start and keeps the draft', async () => {
    createSessionMock().mockRejectedValue(new Error('Branch "x" already exists'));
    render(DraftPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(draftStore.draft).not.toBeNull();
  });

  it('discards the draft', async () => {
    render(DraftPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(draftStore.draft).toBeNull();
  });
});

describe('DraftPane credentials', () => {
  it('asks for a key when the agent has none, and blocks starting', async () => {
    store.prerequisites = status(false);
    render(DraftPane);
    expect(await screen.findByLabelText('Anthropic API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await waitFor(() => expect(mockGroveBench.checkPrerequisites).toHaveBeenCalled());
  });

  it('says why Enter does nothing while credentials are missing', async () => {
    store.prerequisites = status(false);
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute('title', 'Add credentials above to start.'));
    expect(screen.queryByText('Add credentials above to start.')).toBeNull();
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('Add credentials above to start.')).toBeInTheDocument();
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('confirms when credentials turn up after a Re-check', async () => {
    const signedIn = status(true);
    signedIn.agents['claude-code'].email = 'sam@example.com';
    store.prerequisites = status(false);
    mockGroveBench.checkPrerequisites.mockResolvedValueOnce(status(false)).mockResolvedValue(signedIn);
    render(DraftPane);
    await fireEvent.click(await screen.findByRole('button', { name: 'Re-check' }));
    expect(await screen.findByText(/Signed in as sam@example.com\. You're ready to start\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
  });

  it('asks for a new key when the saved one was refused', async () => {
    const refused = status(true);
    refused.agents['claude-code'].apiKey = { label: 'Anthropic API key', helpUrl: 'https://example.com/keys', saved: true, canStore: true, rejected: true };
    store.prerequisites = refused;
    mockGroveBench.checkPrerequisites.mockResolvedValue(refused);
    render(DraftPane);
    expect(await screen.findByText(/couldn't sign in with the saved API key/)).toBeInTheDocument();
    expect(screen.getByText(/The saved key was refused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('says git is missing in a new conversation, with a way to get it', async () => {
    store.prerequisites = { ...status(true), git: { available: false } };
    render(DraftPane);
    expect(await screen.findByText(/Git isn't installed/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Download Git' }));
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://git-scm.com/downloads');
  });

  it('checks the picked agent\'s own credentials', async () => {
    agentsStore.list = [claude, codex];
    store.prerequisites = status(true, false);
    mockGroveBench.checkPrerequisites.mockResolvedValue(status(true, false));
    render(DraftPane);
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();

    draftStore.setAgent('codex');
    expect(await screen.findByLabelText('OpenAI API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('DraftPane sign-in choices', () => {
  const cliSignIn = {
    accountLabel: 'Claude plan',
    accountDetail: 'Pro, Max, Team or Enterprise',
    cliName: 'Claude Code',
    command: 'claude',
    setupUrl: 'https://example.com/setup',
  };
  function withCli(available: boolean): PrerequisiteStatus {
    const s = status(false);
    s.agents['claude-code'] = {
      ...s.agents['claude-code'],
      available,
      cliSignIn,
      apiKey: { ...s.agents['claude-code'].apiKey!, billingNote: 'Billed per use, separately from any plan.' },
    };
    return s;
  }

  it('offers the plan sign-in first, then an API key with how it is billed', async () => {
    store.prerequisites = withCli(true);
    mockGroveBench.checkPrerequisites.mockResolvedValue(withCli(true));
    render(DraftPane);
    expect(await screen.findByText('Claude Agent runs on Claude Code, so it signs in the same way.')).toBeInTheDocument();
    const plan = await screen.findByRole('region', { name: 'Sign in with Claude Code' });
    expect(plan).toHaveTextContent('Use your Claude plan (Pro, Max, Team or Enterprise)');
    expect(plan).toHaveTextContent('Run claude in a terminal and sign in when it asks');
    expect(screen.queryByRole('button', { name: 'How to install Claude Code' })).toBeNull();
    const key = screen.getByRole('region', { name: 'Use an API key' });
    expect(key).toHaveTextContent('Or use an API key');
    expect(key).toHaveTextContent('Billed per use, separately from any plan. Stored encrypted');
  });

  it('links to the install guide when the CLI is not installed', async () => {
    store.prerequisites = withCli(false);
    mockGroveBench.checkPrerequisites.mockResolvedValue(withCli(false));
    render(DraftPane);
    const install = await screen.findByRole('button', { name: 'How to install Claude Code' });
    await fireEvent.click(install);
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://example.com/setup');
  });
});

describe('DraftPane for agents that sign in with their own CLI', () => {
  const gemini: AgentSummary = { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} };
  const cliSignIn = { accountLabel: 'Google account', cliName: 'Gemini CLI', command: 'gemini', setupUrl: 'https://example.com/gemini' };
  function withGemini(agent: Partial<AgentPrerequisiteStatus>): PrerequisiteStatus {
    const s = status(true);
    s.agents['gemini-cli'] = { available: true, installRequired: true, cliSignIn, signInCheckable: true, ...agent } as AgentPrerequisiteStatus;
    return s;
  }

  beforeEach(() => {
    agentsStore.list = [claude, gemini];
  });

  it('says it is signed out, in the agent\'s own words, with the command to copy and a real check', async () => {
    const signedOut = withGemini({ authenticated: false, authMessage: 'This client is no longer supported' });
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockResolvedValue(signedOut);
    mockGroveBench.checkAgentSignIn.mockResolvedValue(signedOut);
    draftStore.setAgent('gemini-cli');
    render(DraftPane);

    expect(await screen.findByText("Gemini CLI isn't signed in.")).toBeInTheDocument();
    expect(screen.getByTestId('auth-message')).toHaveTextContent('Gemini CLI said: This client is no longer supported');
    expect(screen.getByRole('group', { name: 'Sign-in command' })).toHaveTextContent('gemini');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
    expect(mockGroveBench.checkAgentSignIn).toHaveBeenCalledWith('gemini-cli');
    expect(await screen.findByRole('alert')).toHaveTextContent("Gemini CLI still isn't signed in.");
  });

  it('asks for the program before a saved key counts, with its install command', async () => {
    const missing = withGemini({
      available: false, authenticated: false, installCommand: 'npm install -g @google/gemini-cli',
      apiKey: { label: 'Gemini API key', helpUrl: 'https://example.com', saved: true, canStore: true },
    });
    store.prerequisites = missing;
    mockGroveBench.checkPrerequisites.mockResolvedValue(missing);
    draftStore.setAgent('gemini-cli');
    render(DraftPane);

    expect(await screen.findByText("Gemini CLI isn't installed on this computer.")).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Install command' })).toHaveTextContent('npm install -g @google/gemini-cli');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('DraftPane with no agent', () => {
  it('says so instead of waiting forever, and can try again', async () => {
    agentsStore.list = [];
    draftStore.discard();
    draftStore.open('/repo/one');
    draftStore.draft!.agentId = '';
    mockGroveBench.listAdapters.mockResolvedValue([]);
    render(DraftPane);
    expect(await screen.findByText(/No agent is available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    mockGroveBench.listAdapters.mockResolvedValue([claude]);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(draftStore.draft?.agentId).toBe('claude-code'));
    expect(await screen.findByLabelText('First message')).toBeInTheDocument();
  });

describe('DraftPane git identity heads-up', () => {
  it('warns before the first message when git has no name and email for the project', async () => {
    mockGroveBench.hasGitIdentity.mockResolvedValue(false);
    render(DraftPane);
    expect(await screen.findByText(/Git doesn't have your name and email for this project/)).toBeInTheDocument();
    expect(screen.getByText(/before or after you start/)).toBeInTheDocument();
    expect(mockGroveBench.hasGitIdentity).toHaveBeenCalledWith('/repo/one');
    mockGroveBench.hasGitIdentity.mockResolvedValue(true);
  });

  it('says nothing when git knows who you are', async () => {
    render(DraftPane);
    await waitFor(() => expect(mockGroveBench.hasGitIdentity).toHaveBeenCalled());
    await settle();
    expect(screen.queryByText(/Git doesn't have your name and email/)).not.toBeInTheDocument();
  });

  it('does not ask in a folder project without git', async () => {
    store.setFolderProject('/repo/one', true);
    mockGroveBench.repoKind.mockResolvedValue('folder');
    draftStore.discard();
    draftStore.open('/repo/one');
    await settle();
    render(DraftPane);
    await settle();
    expect(mockGroveBench.hasGitIdentity).not.toHaveBeenCalled();
    expect(screen.getByText(/project folder itself, without git, so its edits land in place/)).toBeInTheDocument();
    expect(screen.getByText('Change the agent, model or mode in the bar below before you send.')).toBeInTheDocument();
    store.setFolderProject('/repo/one', false);
    mockGroveBench.repoKind.mockResolvedValue('git');
  });
});
});
