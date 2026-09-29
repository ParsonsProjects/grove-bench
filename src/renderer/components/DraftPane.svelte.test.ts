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
