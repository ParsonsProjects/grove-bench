import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import ScheduleForm from './ScheduleForm.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import type { SkillSchedule, SkillScheduleInput } from '../../shared/skill-schedules.js';
import type { ControlDescriptor } from '../../shared/types.js';

const existing: SkillScheduleInput = {
  id: 's1', repoPath: '/repo', agentId: 'gemini-cli', skill: 'work-linear-issue', note: 'Take the top agent-ready issue.',
  start: 'new', permissionMode: '', timing: { kind: 'every', hours: 2 }, maxOpen: 1, paused: false,
};

const skills = [
  { name: 'triage', description: 'Sort new issues', source: 'project' as const },
  { name: 'work-linear-issue', description: 'Fix a Linear issue', source: 'project' as const },
];

const acpModes: ControlDescriptor = {
  id: 'permissionMode', label: 'Mode', default: 'default',
  options: [{ value: 'default', label: 'Ask' }, { value: 'acceptEdits', label: 'Edit' }, { value: 'readSafe', label: 'Read-safe' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} },
  ];
  agentsStore.loaded = true;
  mockGroveBench.listAgentSkills.mockResolvedValue(skills);
  mockGroveBench.getAdapterControls.mockResolvedValue([acpModes]);
  mockGroveBench.saveSkillSchedule.mockImplementation(async (input: SkillScheduleInput) => ({ ...input, id: input.id ?? 'new' }) as SkillSchedule);
});

afterEach(() => {
  cleanup();
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, disabledSkills: [] };
});

describe('ScheduleForm', () => {
  it('asks before Cancel drops changes, and not when there are none', async () => {
    const onclose = vi.fn();
    skillsPanelStore.editSchedule('/repo', existing);
    render(ScheduleForm, { repoPath: '/repo', initial: existing, onclose });
    await waitFor(() => expect(mockGroveBench.listAgentSkills).toHaveBeenCalled());
    // Untouched: Cancel just goes back.
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onclose).toHaveBeenCalledTimes(1);

    await fireEvent.input(screen.getByLabelText(/Note/), { target: { value: 'Something else' } });
    await waitFor(() => expect(skillsPanelStore.formDirty).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Discard your changes to this schedule?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onclose).toHaveBeenCalledTimes(2);
    skillsPanelStore.close();
  });

  it('edits a schedule and saves a plain copy of it, then goes back', async () => {
    const onclose = vi.fn();
    render(ScheduleForm, { repoPath: '/repo', initial: existing, onclose });
    const note = screen.getByLabelText<HTMLTextAreaElement>(/Note/);
    expect(note.value).toBe('Take the top agent-ready issue.');
    await fireEvent.input(note, { target: { value: 'Take the two top issues.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onclose).toHaveBeenCalled());
    const sent = mockGroveBench.saveSkillSchedule.mock.calls[0][0];
    // What goes over IPC must survive structured cloning (no state proxies).
    expect(structuredClone(sent)).toEqual({ ...existing, note: 'Take the two top issues.' });
  });

  it("starts a new schedule for the skill it was given, with that agent's skills and modes", async () => {
    render(ScheduleForm, { repoPath: '/repo', initial: { agentId: 'gemini-cli', skill: 'triage' }, onclose: () => {} });
    await waitFor(() => expect(mockGroveBench.listAgentSkills).toHaveBeenCalledWith('gemini-cli', '/repo'));
    expect(mockGroveBench.getAdapterControls).toHaveBeenCalledWith('gemini-cli');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockGroveBench.saveSkillSchedule).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'gemini-cli', skill: 'triage', note: '', timing: { kind: 'daily', time: '09:00', weekdaysOnly: true },
    })));
  });

  it("drops a mode the agent doesn't have, which would quietly start in Ask", async () => {
    render(ScheduleForm, { repoPath: '/repo', initial: { ...existing, permissionMode: 'auto' }, onclose: () => {} });
    await waitFor(() => expect(mockGroveBench.getAdapterControls).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockGroveBench.saveSkillSchedule).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: '' })));
  });

  it('says so only once the list is in: no skills, or a failed read', async () => {
    let finish!: (list: typeof skills) => void;
    mockGroveBench.listAgentSkills.mockReturnValue(new Promise((r) => { finish = r; }));
    render(ScheduleForm, { repoPath: '/repo', initial: { agentId: 'gemini-cli' }, onclose: () => {} });
    await waitFor(() => expect(mockGroveBench.listAgentSkills).toHaveBeenCalled());
    expect(screen.queryByText(/has no skills/)).toBeNull();
    finish([]);
    expect(await screen.findByText(/has no skills in this project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    cleanup();

    mockGroveBench.listAgentSkills.mockRejectedValue(new Error('EACCES'));
    render(ScheduleForm, { repoPath: '/repo', initial: { agentId: 'gemini-cli' }, onclose: () => {} });
    expect(await screen.findByText(/Couldn't read Gemini CLI's skills/)).toBeInTheDocument();
    expect(screen.queryByText(/has no skills/)).toBeNull();
  });

  it("doesn't offer a Claude Code skill that is turned off", async () => {
    settingsStore.current = { ...settingsStore.current, disabledSkills: ['triage', 'work-linear-issue'] };
    render(ScheduleForm, { repoPath: '/repo', initial: { agentId: 'claude-code' }, onclose: () => {} });
    expect(await screen.findByText(/has no skills in this project that are turned on/)).toBeInTheDocument();
  });

  it("shows main's reason when a save is refused", async () => {
    mockGroveBench.saveSkillSchedule.mockRejectedValue(new Error("Error invoking remote method 'skillSchedules:save': Error: Enter how many hours apart"));
    render(ScheduleForm, { repoPath: '/repo', initial: existing, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter how many hours apart')).toBeInTheDocument();
  });

  it('says next to Save what is missing, in the words main would use', async () => {
    render(ScheduleForm, { repoPath: '/repo', initial: { agentId: 'gemini-cli' }, onclose: () => {} });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(await screen.findByText('Pick a skill above')).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-describedby', 'schedule-save-blocker');
    cleanup();

    render(ScheduleForm, { repoPath: '/repo', initial: { ...existing, timing: { kind: 'every', hours: 0 } }, onclose: () => {} });
    expect(await screen.findByText('Enter how many hours apart, from 1 to 168')).toBeInTheDocument();
    cleanup();

    render(ScheduleForm, { repoPath: '/repo', initial: { ...existing, timing: { kind: 'daily', time: '25:00', weekdaysOnly: false } }, onclose: () => {} });
    expect(await screen.findByText('Use a 24-hour time such as 09:00')).toBeInTheDocument();
    cleanup();

    render(ScheduleForm, { repoPath: '/repo', initial: existing, onclose: () => {} });
    await fireEvent.input(screen.getByLabelText('Open threads before a run is skipped'), { target: { value: '' } });
    expect(await screen.findByText('Allow from 1 to 10 open threads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Open threads before a run is skipped'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.queryByText(/Allow from/)).toBeNull();
  });

  it('loads the agents for its picker, as nothing else may have yet', async () => {
    agentsStore.loaded = false;
    mockGroveBench.listAdapters.mockResolvedValue([{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} }]);
    render(ScheduleForm, { repoPath: '/repo', onclose: () => {} });
    await waitFor(() => expect(agentsStore.loaded).toBe(true));
    expect(agentsStore.list.map((a) => a.id)).toEqual(['gemini-cli']);
  });
});
