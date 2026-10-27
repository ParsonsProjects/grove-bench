import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { SkillSchedule } from '../../shared/skill-schedules.js';

const startThreadFor = vi.hoisted(() => vi.fn());
vi.mock('./draft.svelte.js', () => ({ draftStore: { startThreadFor } }));

import { schedulesStore } from './schedules.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { settingsStore } from './settings.svelte.js';

const schedule = (over: Partial<SkillSchedule> = {}): SkillSchedule => ({
  id: 's1',
  repoPath: '/repo',
  agentId: 'gemini-cli',
  skill: 'work-linear-issue',
  note: 'Take the top agent-ready issue.',
  start: 'new',
  permissionMode: 'plan',
  timing: { kind: 'every', hours: 2 },
  maxOpen: 1,
  paused: false,
  scheduledFrom: 0,
  checkedThrough: 0,
  sessionIds: [],
  ...over,
});

const thread = (id: string, status: 'running' | 'stopped') =>
  ({ id, branch: 'b', repoPath: '/repo', status, createdAt: 0 }) as (typeof sessionStore.sessions)[number];

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.repos = ['/repo'];
  sessionStore.sessions = [];
  sessionStore.deferredResume = {};
  sessionStore.error = null;
  schedulesStore.list = [];
  schedulesStore.starting = {};
  startThreadFor.mockResolvedValue({ id: 'new1' });
  mockGroveBench.recordSkillScheduleRun.mockImplementation(async (id: string, outcome: object) => ({ ...schedule({ id }), lastOutcome: { at: 1, ...outcome } }));
});

describe('schedulesStore.runSkill', () => {
  it("runs a skill once in a thread that opens, on its agent and model only", async () => {
    expect(await schedulesStore.runSkill({
      repoPath: '/repo', agentId: 'claude-code', model: 'opus', skill: 'triage', note: '', start: 'new', permissionMode: '',
    })).toBe(true);
    expect(startThreadFor).toHaveBeenCalledWith({
      repoPath: '/repo',
      text: 'Use the `triage` skill.',
      agentId: 'claude-code',
      model: 'opus',
      start: { kind: 'new', branchName: '', baseBranch: '' },
      focus: true,
      strictAgent: true,
      quiet: true,
    });
    expect(mockGroveBench.recordSkillScheduleRun).not.toHaveBeenCalled();
  });

  it('says why it did not start, naming the skill', async () => {
    startThreadFor.mockResolvedValue({ error: 'its agent is turned off or was removed' });
    expect(await schedulesStore.runSkill({
      repoPath: '/repo', agentId: 'gone', skill: 'triage', note: '', start: 'folder', permissionMode: '',
    })).toBe(false);
    expect(sessionStore.error).toBe(`Skill "triage" didn't start a thread: its agent is turned off or was removed.`);
  });
});

describe('schedulesStore.run', () => {
  it('runs now in a thread that opens, with its mode and note, and notes it', async () => {
    expect(await schedulesStore.run(schedule())).toBe(true);
    expect(startThreadFor).toHaveBeenCalledWith({
      repoPath: '/repo',
      text: 'Use the `work-linear-issue` skill for this task.\n\nTake the top agent-ready issue.',
      agentId: 'gemini-cli',
      start: { kind: 'new', branchName: '', baseBranch: '' },
      controls: { permissionMode: 'plan' },
      focus: true,
      strictAgent: true,
      quiet: true,
    });
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { sessionId: 'new1' });
  });

  it('starts a scheduled run without taking the screen', async () => {
    await schedulesStore.run(schedule({ start: 'folder', permissionMode: '' }), { scheduled: true });
    const setup = startThreadFor.mock.calls[0][0];
    expect(setup).toMatchObject({ start: { kind: 'folder' }, focus: false });
    expect(setup).not.toHaveProperty('controls');
  });

  it('skips a scheduled run while its threads are still open, but not Run now', async () => {
    sessionStore.sessions = [thread('old', 'running')];
    const capped = schedule({ sessionIds: ['old'] });
    expect(await schedulesStore.run(capped, { scheduled: true })).toBe(false);
    expect(startThreadFor).not.toHaveBeenCalled();
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: '1 thread from it is still open' });
    expect(sessionStore.error).toBeNull();

    expect(await schedulesStore.run(capped)).toBe(true);
  });

  it("skips a removed project's scheduled run quietly", async () => {
    sessionStore.repos = [];
    expect(await schedulesStore.run(schedule(), { scheduled: true })).toBe(false);
    expect(startThreadFor).not.toHaveBeenCalled();
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: 'its project was removed' });
    expect(sessionStore.error).toBeNull();
  });

  it('counts a thread waiting to reconnect after a restart or wake, not a closed one', async () => {
    sessionStore.sessions = [thread('waiting', 'stopped'), thread('closed', 'stopped')];
    sessionStore.deferResume('waiting');
    expect(schedulesStore.openThreads(schedule({ sessionIds: ['waiting', 'closed'] }))).toBe(1);
    expect(await schedulesStore.run(schedule({ sessionIds: ['waiting'] }), { scheduled: true })).toBe(false);
    expect(await schedulesStore.run(schedule({ sessionIds: ['closed'] }), { scheduled: true })).toBe(true);
  });

  it('notes why a thread did not start, and says so with the skill named', async () => {
    startThreadFor.mockResolvedValue({ error: "Branch 'x' already exists." });
    expect(await schedulesStore.run(schedule(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { error: "Branch 'x' already exists." });
    expect(sessionStore.error).toBe(`Scheduled skill "work-linear-issue" didn't start a thread: Branch 'x' already exists.`);
  });

  it('notes a start that threw rather than lose the run', async () => {
    startThreadFor.mockRejectedValue(new Error('IPC gone'));
    expect(await schedulesStore.run(schedule(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { error: 'IPC gone' });
    expect(schedulesStore.starting).toEqual({});
  });

  it('notes a scheduled run that came while Run now was starting', async () => {
    schedulesStore.starting = { s1: 'hand' };
    expect(await schedulesStore.run(schedule(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: 'a run by hand was starting' });
    mockGroveBench.recordSkillScheduleRun.mockClear();
    expect(await schedulesStore.run(schedule())).toBe(false);
    expect(mockGroveBench.recordSkillScheduleRun).not.toHaveBeenCalled();
  });

  it('says so when the last scheduled run is still starting, not that one was run by hand', async () => {
    schedulesStore.starting = { s1: 'schedule' };
    expect(await schedulesStore.run(schedule(), { scheduled: true })).toBe(false);
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: 'the last run was still starting' });
  });

  it('marks who started a run while it starts', async () => {
    let finish!: (r: { id: string }) => void;
    startThreadFor.mockReturnValue(new Promise((r) => { finish = r; }));
    const running = schedulesStore.run(schedule(), { scheduled: true });
    await vi.waitFor(() => expect(schedulesStore.starting).toEqual({ s1: 'schedule' }));
    finish({ id: 'new1' });
    await running;
    expect(schedulesStore.starting).toEqual({});
  });
});

describe('a skill turned off', () => {
  beforeEach(() => {
    agentsStore.list = [
      { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
      { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { skills: false } },
    ] as typeof agentsStore.list;
    agentsStore.loaded = true;
    settingsStore.current = { ...settingsStore.current, disabledSkills: ['work-linear-issue'] };
  });

  it("skips a due run of a Claude Code skill that's turned off, and says why", async () => {
    const off = schedule({ agentId: 'claude-code' });
    schedulesStore.list = [off];
    expect(schedulesStore.turnedOff(off)).toBe(true);
    expect(await schedulesStore.run(off, { scheduled: true })).toBe(false);
    expect(startThreadFor).not.toHaveBeenCalled();
    expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: 'the "work-linear-issue" skill is turned off' });

    // By hand: a toast instead.
    expect(await schedulesStore.run(off)).toBe(false);
    expect(sessionStore.error).toMatch(/it's turned off/);
  });

  it("runs another agent's skill of the same name, which Grove doesn't turn off", async () => {
    const other = schedule({ agentId: 'gemini-cli' });
    expect(schedulesStore.turnedOff(other)).toBe(false);
    expect(await schedulesStore.run(other, { scheduled: true })).toBe(true);
  });
});

describe('schedulesStore.load', () => {
  it('asks again while the file is locked', async () => {
    mockGroveBench.listSkillSchedules.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('ipc')).mockResolvedValueOnce([schedule()]);
    await schedulesStore.load(0);
    expect(mockGroveBench.listSkillSchedules).toHaveBeenCalledTimes(3);
    expect(schedulesStore.list.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('a due run', () => {
  // init() subscribes once for the whole file (hooks aren't shuffled).
  let due: (id: string) => void = () => {};
  beforeAll(() => {
    mockGroveBench.onSkillScheduleDue.mockImplementation((cb: (id: string) => void) => { due = cb; return () => {}; });
    schedulesStore.init();
  });

  it("is skipped and noted until the window has restored its threads, which the cap counts", async () => {
    schedulesStore.restored = false;
    schedulesStore.list = [schedule()];
    due('s1');
    await vi.waitFor(() => expect(mockGroveBench.recordSkillScheduleRun).toHaveBeenCalledWith('s1', { skipped: 'Grove was still restoring its threads' }));
    expect(startThreadFor).not.toHaveBeenCalled();
  });

  it('fetches the list when the schedule is missing from it, then runs', async () => {
    schedulesStore.markRestored();
    schedulesStore.list = [];
    mockGroveBench.listSkillSchedules.mockResolvedValue([schedule({ id: 'late' })]);
    due('late');
    await vi.waitFor(() => expect(startThreadFor).toHaveBeenCalled());
    expect(startThreadFor.mock.calls[0][0]).toMatchObject({ focus: false });
  });
});
