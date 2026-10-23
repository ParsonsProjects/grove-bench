import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import StatusBarSkills from './StatusBarSkills.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { schedulesStore } from '../stores/schedules.svelte.js';

const skills = [{ name: 'triage', description: 'Sort new issues', source: 'project' as const }];

function thread(agentType: string) {
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType, createdAt: 0 }] as typeof store.sessions;
}

async function openPopover() {
  render(StatusBarSkills, { sessionId: 't1' });
  await fireEvent.click(await screen.findByRole('button', { name: /^Skills 1/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { skills: false } },
  ];
  agentsStore.loaded = true;
  schedulesStore.dialog = null;
  mockGroveBench.listSkills.mockResolvedValue(skills);
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
});

describe('StatusBarSkills', () => {
  it('runs a skill in a new thread on the thread\'s own agent', async () => {
    thread('gemini-cli');
    const runSkill = vi.spyOn(schedulesStore, 'runSkill').mockResolvedValue(true);
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: 'Run triage in a new thread' }));
    expect(runSkill).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo', agentId: 'gemini-cli', skill: 'triage', note: '', start: 'new', permissionMode: '',
    }));
    runSkill.mockRestore();
  });

  it('opens the project\'s scheduled skills on a new schedule for the skill', async () => {
    thread('gemini-cli');
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: 'Schedule triage' }));
    expect(schedulesStore.dialog).toEqual({ repoPath: '/repo', prefill: { agentId: 'gemini-cli', skill: 'triage' } });
  });

  it("offers turning off, suggesting and adding skills only for an agent Grove manages them for", async () => {
    thread('gemini-cli');
    await openPopover();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add skill/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull();
    expect(screen.getByText(/Gemini CLI's own folders/)).toBeInTheDocument();
    cleanup();

    thread('claude-code');
    await openPopover();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Add skill/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeInTheDocument();
  });
});
