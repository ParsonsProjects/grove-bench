import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import NewAgentDialog from './NewAgentDialog.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { AgentPrerequisiteStatus, AgentSummary, PrerequisiteStatus } from '../../shared/types.js';

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
  store.prerequisites = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('NewAgentDialog credentials step', () => {
  it('goes straight to the form when the agent is signed in', () => {
    store.prerequisites = signedIn;
    render(NewAgentDialog, { onclose: vi.fn() });

    expect(screen.getByText('Branch Mode')).toBeInTheDocument();
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument();
    expect(mockGroveBench.checkPrerequisites).not.toHaveBeenCalled();
  });

  it('re-checks a cached signed-out state before asking for a key', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    render(NewAgentDialog, { onclose: vi.fn() });

    await waitFor(() => expect(mockGroveBench.checkPrerequisites).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
  });

  it('asks for a key when there are no credentials, then shows the form once saved', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });

    const input = await screen.findByLabelText('Anthropic API key');
    expect(screen.queryByText('Branch Mode')).not.toBeInTheDocument();

    await fireEvent.input(input, { target: { value: 'sk-test-123' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('claude-code', 'sk-test-123');
    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
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
    expect(screen.queryByText('Branch Mode')).not.toBeInTheDocument();
  });

  it('lets the user re-check after signing in with the CLI', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });
    await screen.findByLabelText('Anthropic API key');

    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    await fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
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
    expect(screen.getByText('Branch Mode')).toBeInTheDocument();

    await pickAgent('Codex');

    const input = await screen.findByLabelText('OpenAI API key');
    expect(screen.queryByText('Branch Mode')).not.toBeInTheDocument();
    await fireEvent.input(input, { target: { value: 'sk-openai' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('codex', 'sk-openai');
    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
  });

  it('starts the conversation on the picked agent', async () => {
    agentsStore.list = [claude, codex];
    store.prerequisites = status(true, true);
    const createSession = (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
    createSession.mockResolvedValue({ id: 'new', branch: 'main', agentType: 'codex' });
    render(NewAgentDialog, { onclose: vi.fn() });

    await pickAgent('Codex');
    await fireEvent.click(await screen.findByRole('button', { name: 'Direct' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ adapterType: 'codex', direct: true })));
    expect(store.sessions.find((s) => s.id === 'new')?.agentType).toBe('codex');
    store.sessions = [];
  });
});
