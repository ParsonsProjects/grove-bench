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

  it("offers turning off and suggesting skills only for an agent Grove manages them for, and adding for any", async () => {
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add skill/ })).toBeInTheDocument();
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

  it('has no Share or Link to offer when every skill is shared and linked', async () => {
    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(mockGroveBench.getSkillSharing).toHaveBeenCalledWith('t1', '/repo');
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Link/ })).toBeNull();
  });

  it("shares Claude Agent's own skills, then lists again and says what it couldn't move", async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({
      toShare: [{ name: 'triage', description: '', source: 'project' }, { name: 'deploy', description: '', source: 'user' }],
      toLink: [],
      broken: [],
    });
    mockGroveBench.shareSkills.mockResolvedValue({ done: ['triage'], skipped: [{ name: 'deploy', reason: 'a file in it is open in another program' }] });
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByText('Share 2 skills with every agent')).toBeInTheDocument();
    expect(screen.getByText(/triage and deploy are in/)).toBeInTheDocument();
    mockGroveBench.listSkills.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(mockGroveBench.shareSkills).toHaveBeenCalledWith('t1', '/repo');
    await waitFor(() => expect(store.error).toBe(`Couldn't share "deploy" (a file in it is open in another program).`));
    await waitFor(() => expect(screen.queryByText('Share 2 skills with every agent')).toBeNull());
    expect(mockGroveBench.listSkills).toHaveBeenCalled();
    store.setError(null);
  });

  it('adds, updates and removes Claude Agent links', async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({
      toShare: [],
      toLink: [{ name: 'team', description: '', source: 'project' }],
      broken: [{ name: 'gone', description: '', source: 'project' }],
    });
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByText(/adds or updates the links for team, and removes the links to gone, which was deleted\./)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(mockGroveBench.linkSkills).toHaveBeenCalledWith('t1', '/repo');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Link' })).toBeNull());
    expect(store.error).toBeNull();
  });
});
