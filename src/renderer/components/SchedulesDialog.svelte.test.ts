import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import SchedulesDialog from './SchedulesDialog.svelte';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { SkillSchedule, SkillScheduleInput } from '../../shared/skill-schedules.js';

const schedule: SkillSchedule = {
  id: 's1', repoPath: '/repo', agentId: 'gemini-cli', skill: 'work-linear-issue', note: 'Take the top agent-ready issue.',
  start: 'new', permissionMode: '', timing: { kind: 'every', hours: 2 },
  maxOpen: 1, paused: false, scheduledFrom: 0, checkedThrough: 0, sessionIds: [],
};

const skills = [
  { name: 'triage', description: 'Sort new issues', source: 'project' as const },
  { name: 'work-linear-issue', description: 'Fix a Linear issue', source: 'project' as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} },
  ];
  agentsStore.loaded = true;
  schedulesStore.list = [schedule, { ...schedule, id: 'other', repoPath: '/elsewhere', skill: 'not-this-project' }];
  mockGroveBench.listAgentSkills.mockResolvedValue(skills);
  mockGroveBench.saveSkillSchedule.mockImplementation(async (input: SkillScheduleInput) => ({ ...schedule, ...input, id: input.id ?? 'new' }));
});

afterEach(() => {
  cleanup();
  schedulesStore.list = [];
  store.repos = [];
});

describe('SchedulesDialog', () => {
  it("lists the project's schedules only", () => {
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    expect(screen.getByText('work-linear-issue')).toBeInTheDocument();
    expect(screen.queryByText('not-this-project')).toBeNull();
    expect(screen.getByText(/Every 2 hours · Gemini CLI/)).toBeInTheDocument();
  });

  it('edits a schedule and saves a plain copy of it', async () => {
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const note = screen.getByLabelText(/Note/) as HTMLTextAreaElement;
    expect(note.value).toBe('Take the top agent-ready issue.');
    await fireEvent.input(note, { target: { value: 'Take the two top issues.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockGroveBench.saveSkillSchedule).toHaveBeenCalled());
    const sent = mockGroveBench.saveSkillSchedule.mock.calls[0][0];
    // What goes over IPC must survive structured cloning (no state proxies).
    expect(structuredClone(sent)).toEqual({
      id: 's1', repoPath: '/repo', agentId: 'gemini-cli', skill: 'work-linear-issue', note: 'Take the two top issues.',
      start: 'new', permissionMode: '', timing: { kind: 'every', hours: 2 }, maxOpen: 1, paused: false,
    });
  });

  it('opens on a new schedule for the skill it was given, with that agent\'s skills to pick from', async () => {
    render(SchedulesDialog, { repoPath: '/repo', prefill: { agentId: 'gemini-cli', skill: 'triage' }, onclose: () => {} });
    await waitFor(() => expect(mockGroveBench.listAgentSkills).toHaveBeenCalledWith('gemini-cli', '/repo'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockGroveBench.saveSkillSchedule).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'gemini-cli', skill: 'triage', note: '', timing: { kind: 'daily', time: '09:00', weekdaysOnly: true },
    })));
  });

  it('says so when the agent has no skills in the project, and can\'t save without one', async () => {
    mockGroveBench.listAgentSkills.mockResolvedValue([]);
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Schedule a skill' }));
    expect(await screen.findByText(/has no skills in this project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it("shows main's reason when a save is refused", async () => {
    mockGroveBench.saveSkillSchedule.mockRejectedValue(new Error("Error invoking remote method 'skillSchedules:save': Error: Enter how many hours apart"));
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter how many hours apart')).toBeInTheDocument();
  });

  it('loads the agents for its picker, as nothing else may have yet', async () => {
    agentsStore.loaded = false;
    mockGroveBench.listAdapters.mockResolvedValue([{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} }]);
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await waitFor(() => expect(agentsStore.loaded).toBe(true));
    expect(agentsStore.list.map((a) => a.id)).toEqual(['gemini-cli']);
  });

  it("shows a refused pause in a toast without Electron's wrapper", async () => {
    mockGroveBench.saveSkillSchedule.mockRejectedValue(new Error("Error invoking remote method 'skillSchedules:save': Error: Schedules can't be read right now."));
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(store.error).toBe("Schedules can't be read right now."));
    store.clearError();
  });

  it('pauses a schedule', async () => {
    render(SchedulesDialog, { repoPath: '/repo', onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mockGroveBench.saveSkillSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', paused: true })));
  });
});
