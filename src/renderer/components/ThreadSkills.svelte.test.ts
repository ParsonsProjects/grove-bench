import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import ThreadSkills from './ThreadSkills.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';

const skills = [{ name: 'triage', description: 'Sort new issues', source: 'project' as const }];

function thread(agentType: string) {
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType, createdAt: 0 }] as typeof store.sessions;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { skills: false } },
  ];
  agentsStore.loaded = true;
  skillsPanelStore.showThread();
  mockGroveBench.listSkills.mockResolvedValue(skills);
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
  store.sessions = [];
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, disabledSkills: [] };
});

describe('ThreadSkills', () => {
  it("runs a skill in a new thread on the thread's own agent, and closes the drawer once it starts", async () => {
    thread('gemini-cli');
    const runSkill = vi.spyOn(schedulesStore, 'runSkill').mockResolvedValue(true);
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Run triage in a new thread' }));
    expect(runSkill).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo', agentId: 'gemini-cli', skill: 'triage', note: '', start: 'new', permissionMode: '',
    }));
    await waitFor(() => expect(skillsPanelStore.open).toBe(false));
    runSkill.mockRestore();
  });

  it("keeps the drawer open when the thread doesn't start", async () => {
    thread('gemini-cli');
    const runSkill = vi.spyOn(schedulesStore, 'runSkill').mockResolvedValue(false);
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Run triage in a new thread' }));
    await waitFor(() => expect(runSkill).toHaveBeenCalled());
    expect(skillsPanelStore.open).toBe(true);
    runSkill.mockRestore();
  });

  it('opens the Scheduled tab on a new schedule for the skill', async () => {
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Schedule triage' }));
    expect(skillsPanelStore.tab).toBe('scheduled');
    expect(skillsPanelStore.form).toEqual({ repoPath: '/repo', initial: { agentId: 'gemini-cli', skill: 'triage' } });
  });

  it("offers turning off, suggesting and adding skills only for an agent Grove manages them for", async () => {
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add skill/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull();
    expect(screen.getByText(/Gemini CLI's own folders/)).toBeInTheDocument();
    cleanup();

    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Add skill/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeInTheDocument();
  });

  it("shows no Claude-only controls until the agent list says which agent this is", async () => {
    thread('claude-code');
    agentsStore.loaded = false;
    mockGroveBench.listAdapters.mockReturnValue(new Promise(() => {}));
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });

  it("doesn't apply Claude Code's turned-off list to another agent", async () => {
    settingsStore.current = { ...settingsStore.current, disabledSkills: ['triage'] };
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: 'Run triage in a new thread' })).toBeInTheDocument();
    cleanup();

    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run triage in a new thread' })).toBeNull();
  });
});
