import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import WorkspacePane from './WorkspacePane.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';

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
    expect(screen.getByRole('img', { name: 'Ready' })).toBeInTheDocument();

    messageStore.setIsRunning('n1', true);
    expect(await screen.findByRole('img', { name: 'Working' })).toBeInTheDocument();
  });

  it('shows only the message when grove characters are off', async () => {
    settingsStore.current.groveCharacters = false;
    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(WorkspacePane, { sessionId: 'n1' });
    await screen.findByText('Changes needs git');
    expect(screen.queryByRole('img', { name: 'Ready' })).not.toBeInTheDocument();
  });
});
