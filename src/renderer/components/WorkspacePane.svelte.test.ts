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
