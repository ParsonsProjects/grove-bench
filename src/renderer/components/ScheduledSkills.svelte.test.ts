import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import ScheduledSkills from './ScheduledSkills.svelte';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { SkillSchedule, SkillScheduleInput } from '../../shared/skill-schedules.js';

const schedule = (over: Partial<SkillSchedule> = {}): SkillSchedule => ({
  id: 's1', repoPath: '/repo/a', agentId: 'gemini-cli', skill: 'work-linear-issue', note: 'Take the top agent-ready issue.',
  start: 'new', permissionMode: '', timing: { kind: 'every', hours: 2 },
  maxOpen: 1, paused: false, scheduledFrom: 0, checkedThrough: 0, sessionIds: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo/a', '/repo/b'];
  store.sessions = [];
  agentsStore.list = [{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} }];
  agentsStore.loaded = true;
  skillsPanelStore.showScheduled();
  schedulesStore.list = [
    schedule(),
    schedule({ id: 's2', repoPath: '/repo/b', skill: 'triage' }),
    schedule({ id: 's3', repoPath: '/gone', skill: 'old-job' }),
  ];
  mockGroveBench.saveSkillSchedule.mockImplementation(async (input: SkillScheduleInput) => ({ ...schedule(), ...input, id: input.id ?? 'new' }));
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
  schedulesStore.list = [];
  store.repos = [];
});

describe('ScheduledSkills', () => {
  it("lists every project's schedules, the project you came from first and removed ones last", () => {
    skillsPanelStore.showScheduled('/repo/b');
    render(ScheduledSkills);
    const sections = screen.getAllByRole('region');
    expect(sections).toHaveLength(3);
    expect(within(sections[0]).getByText('triage')).toBeInTheDocument();
    expect(within(sections[1]).getByText('work-linear-issue')).toBeInTheDocument();
    expect(within(sections[2]).getByText('/gone (removed project)')).toBeInTheDocument();
  });

  it("lets a removed project's schedule be paused or deleted, but not run or edited", async () => {
    render(ScheduledSkills);
    const removed = screen.getAllByRole('region')[2];
    expect(within(removed).getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(within(removed).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(removed).queryByRole('button', { name: 'Schedule a skill' })).toBeNull();
    await fireEvent.click(within(removed).getByRole('button', { name: 'Delete the schedule for old-job' }));
    await fireEvent.click(within(removed).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockGroveBench.deleteSkillSchedule).toHaveBeenCalledWith('s3'));
  });

  it('opens the form to edit a schedule, with a plain copy of its fields', async () => {
    render(ScheduledSkills);
    await fireEvent.click(within(screen.getAllByRole('region')[0]).getByRole('button', { name: 'Edit' }));
    expect(skillsPanelStore.form).toEqual({
      repoPath: '/repo/a',
      initial: {
        id: 's1', repoPath: '/repo/a', agentId: 'gemini-cli', skill: 'work-linear-issue', note: 'Take the top agent-ready issue.',
        start: 'new', permissionMode: '', timing: { kind: 'every', hours: 2 }, maxOpen: 1, paused: false,
      },
    });
  });

  it("shows a refused pause in a toast without Electron's wrapper", async () => {
    mockGroveBench.saveSkillSchedule.mockRejectedValue(new Error("Error invoking remote method 'skillSchedules:save': Error: Schedules can't be read right now."));
    render(ScheduledSkills);
    await fireEvent.click(within(screen.getAllByRole('region')[0]).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(store.error).toBe("Schedules can't be read right now."));
    store.clearError();
  });

  it('closes the drawer when Run now starts a thread', async () => {
    const run = vi.spyOn(schedulesStore, 'run').mockResolvedValue(true);
    render(ScheduledSkills);
    await fireEvent.click(within(screen.getAllByRole('region')[0]).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(skillsPanelStore.open).toBe(false));
    run.mockRestore();
  });
});
