import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';

import BackgroundAgentDialog from './BackgroundAgentDialog.svelte';
import { backgroundAgentStore } from '../stores/background-agent.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { store } from '../stores/sessions.svelte.js';

beforeEach(() => {
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} },
  ];
  agentsStore.loaded = true;
  store.sessions = [{ id: 'gone', branch: 'b', repoPath: '/repo', status: 'stopped', agentType: 'my-agent' }];
});

afterEach(() => {
  backgroundAgentStore.reset();
  cleanup();
  agentsStore.list = [];
  agentsStore.loaded = false;
  store.sessions = [];
});

describe('BackgroundAgentDialog', () => {
  it('names the missing agent, offers the default, and answers with it', async () => {
    render(BackgroundAgentDialog);
    const answer = backgroundAgentStore.substituteFor('gone', 'write a commit message');
    await waitFor(() => expect(screen.getByText('my-agent')).toBeInTheDocument());
    expect(screen.getByText(/To write a commit message/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Use Claude Agent' }));
    expect(await answer).toBe('claude-code');
  });

  it('sends nothing on Cancel', async () => {
    render(BackgroundAgentDialog);
    const answer = backgroundAgentStore.substituteFor('gone', 'write a goal');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBeNull();
  });
});
