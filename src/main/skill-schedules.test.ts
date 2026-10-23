import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkillSchedule, SkillScheduleInput } from '../shared/skill-schedules.js';
import { MAX_SCHEDULE_SESSIONS, MISSED_AFTER_MS } from '../shared/skill-schedules.js';

/** app-state.json's schedules, as the scheduler and IPC see them. `list`
 *  null is a locked file; `waiting` holds the changes made meanwhile, as
 *  app-state does. */
const saved = vi.hoisted(() => ({
  list: [] as SkillSchedule[] | null,
  writes: [] as boolean[],
  waiting: [] as ((schedules: SkillSchedule[]) => SkillSchedule[])[],
}));

vi.mock('./app-state.js', () => ({
  loadSkillSchedules: () => (saved.list ? structuredClone(saved.list) : null),
  saveSkillSchedules: (schedules: SkillSchedule[], now: boolean) => {
    saved.list = structuredClone(schedules);
    saved.writes.push(now);
  },
  updateSkillSchedules: (mutate: (schedules: SkillSchedule[]) => SkillSchedule[]) => {
    if (saved.list) saved.list = mutate(structuredClone(saved.list));
    else saved.waiting.push(mutate);
  },
}));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Unlock the file: the changes made while it was locked apply. */
function unlock(schedules: SkillSchedule[]): void {
  saved.list = saved.waiting.reduce((list, mutate) => mutate(list), schedules);
  saved.waiting = [];
}

import {
  deleteSchedule, listSchedules, recordScheduleRun, resetSkillSchedulerForTests, saveSchedule,
  startSkillScheduler, stopSkillScheduler, takeDue,
} from './skill-schedules.js';
import { IPC } from '../shared/types.js';

const HOUR = 3_600_000;

const input = (over: Partial<SkillScheduleInput> = {}): SkillScheduleInput => ({
  repoPath: '/repo',
  agentId: 'gemini-cli',
  skill: 'work-linear-issue',
  note: 'Take the top agent-ready issue.',
  start: 'new',
  permissionMode: '',
  timing: { kind: 'every', hours: 2 },
  maxOpen: 1,
  paused: false,
  ...over,
});

beforeEach(() => {
  saved.list = [];
  saved.writes = [];
  saved.waiting = [];
});

describe('saveSchedule', () => {
  it('adds a new schedule whose timing counts from now, saved straight away', () => {
    const schedule = saveSchedule(input(), 1000);
    expect(schedule.id).toBeTruthy();
    expect(schedule).toMatchObject({ skill: 'work-linear-issue', scheduledFrom: 1000, checkedThrough: 1000, sessionIds: [] });
    expect(listSchedules()).toEqual([schedule]);
    expect(saved.writes).toEqual([true]);
  });

  it('keeps the timing position and history when only the note changes', () => {
    const first = saveSchedule(input(), 1000);
    recordScheduleRun(first.id, { sessionId: 's1' }, 2000);
    const edited = saveSchedule({ ...input({ note: 'Something else' }), id: first.id }, 5000);
    expect(edited).toMatchObject({ scheduledFrom: 1000, checkedThrough: 1000, sessionIds: ['s1'], note: 'Something else' });
    expect(edited.lastOutcome).toEqual({ at: 2000, sessionId: 's1' });
  });

  it('restarts the timing from now when it changes or is resumed', () => {
    const first = saveSchedule(input({ paused: true }), 1000);
    expect(saveSchedule({ ...input({ paused: false }), id: first.id }, 5000)).toMatchObject({ scheduledFrom: 5000, checkedThrough: 5000 });
    expect(saveSchedule({ ...input({ timing: { kind: 'every', hours: 3 } }), id: first.id }, 9000)).toMatchObject({ scheduledFrom: 9000 });
  });

  it('refuses a schedule with no skill or agent, a bad time or count, or an id that is gone', () => {
    expect(() => saveSchedule(input({ skill: '  ' }))).toThrow('Pick a skill');
    expect(() => saveSchedule(input({ agentId: '' }))).toThrow('Pick an agent');
    expect(() => saveSchedule(input({ timing: { kind: 'daily', time: '25:00', weekdaysOnly: false } }))).toThrow('24-hour time');
    expect(() => saveSchedule({ ...input(), timing: { kind: 'every', hours: null } })).toThrow('Enter how many hours apart');
    expect(() => saveSchedule({ ...input(), maxOpen: null })).toThrow('Enter how many open threads to allow');
    expect(() => saveSchedule({ ...input(), id: 'gone' })).toThrow('That schedule was deleted');
    expect(saved.list).toEqual([]);
  });

  it("won't save over schedules it couldn't read", () => {
    saved.list = null;
    expect(() => saveSchedule(input())).toThrow("can't be read");
  });
});

describe('listSchedules', () => {
  it("says it can't tell while the file is locked, rather than \"none\"", () => {
    saved.list = null;
    expect(listSchedules()).toBeNull();
  });
});

describe('deleteSchedule', () => {
  it('takes the schedule out', () => {
    const a = saveSchedule(input({ skill: 'a' }), 1);
    const b = saveSchedule(input({ skill: 'b' }), 1);
    deleteSchedule(a.id);
    expect(listSchedules()!.map((s) => s.id)).toEqual([b.id]);
  });
});

describe('recordScheduleRun', () => {
  it('notes the outcome and keeps the last threads', () => {
    const schedule = saveSchedule(input(), 1);
    for (let i = 0; i < MAX_SCHEDULE_SESSIONS + 2; i++) recordScheduleRun(schedule.id, { sessionId: `s${i}` }, 10 + i);
    const after = listSchedules()![0];
    expect(after.sessionIds).toHaveLength(MAX_SCHEDULE_SESSIONS);
    expect(after.sessionIds.at(-1)).toBe(`s${MAX_SCHEDULE_SESSIONS + 1}`);
    expect(after.lastOutcome).toEqual({ at: 10 + MAX_SCHEDULE_SESSIONS + 1, sessionId: `s${MAX_SCHEDULE_SESSIONS + 1}` });
  });

  it('keeps the thread for the cap when the file is locked, and saves it once it can', () => {
    const schedule = saveSchedule(input(), 1);
    const before = saved.list!;
    saved.list = null;
    expect(recordScheduleRun(schedule.id, { sessionId: 's1' }, 5)).toBeNull();
    unlock(before);
    expect(listSchedules()![0]).toMatchObject({ sessionIds: ['s1'], lastOutcome: { at: 5, sessionId: 's1' } });
  });

  it('ignores a schedule deleted meanwhile and a malformed outcome', () => {
    expect(recordScheduleRun('gone', { skipped: 'x' })).toBeNull();
    const schedule = saveSchedule(input(), 1);
    expect(recordScheduleRun(schedule.id, { sessionId: 42 })).toBeNull();
  });
});

describe('takeDue', () => {
  const schedule = (over: Partial<SkillSchedule> = {}): SkillSchedule => ({
    ...input(), id: 's1', scheduledFrom: 0, checkedThrough: 0, sessionIds: [], ...over,
  });

  it('runs a schedule whose time has come and marks it checked', () => {
    const due = takeDue([schedule()], 2 * HOUR + 30_000);
    expect(due.run).toEqual(['s1']);
    expect(due.changed).toBe(true);
    expect(due.schedules[0].checkedThrough).toBe(2 * HOUR + 30_000);
    // Checked: the same time doesn't run twice.
    expect(takeDue(due.schedules, 2 * HOUR + 90_000).run).toEqual([]);
  });

  it('leaves schedules alone before their time, and paused ones', () => {
    const due = takeDue([schedule({ id: 'early' }), schedule({ id: 'paused', paused: true })], 2 * HOUR - 1);
    expect(due).toMatchObject({ run: [], changed: false });
    expect(takeDue([schedule({ id: 'paused', paused: true })], 10 * HOUR).changed).toBe(false);
  });

  it('skips a time found too late, once for any number missed', () => {
    // Every 2 hours from 0: 2:00 to 10:00 all missed, and 10:00 is 30 minutes late.
    const now = 10.5 * HOUR;
    const due = takeDue([schedule()], now);
    expect(due.run).toEqual([]);
    expect(due.schedules[0].lastOutcome?.skipped).toMatch(/closed or the computer was asleep/);
    expect(due.schedules[0].checkedThrough).toBe(now);
    // Just inside the grace period it still runs.
    expect(takeDue([schedule()], 2 * HOUR + MISSED_AFTER_MS).run).toEqual(['s1']);
  });

  it('runs the latest time after a long sleep when that one is still in time', () => {
    // Every 2 hours from 0; asleep from 0:30 to 6:05. 6:00 counts, not 2:00.
    const due = takeDue([schedule({ checkedThrough: HOUR / 2 })], 6 * HOUR + 5 * 60_000);
    expect(due.run).toEqual(['s1']);
    expect(due.schedules[0].lastOutcome).toBeUndefined();
  });

  it("runs today's daily time when Grove opens just after it, days later", () => {
    const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
    const daily = schedule({ timing: { kind: 'daily', time: '09:00', weekdaysOnly: false }, checkedThrough: local(19, 18) });
    expect(takeDue([daily], local(22, 9, 5)).run).toEqual(['s1']);
  });
});

describe('startSkillScheduler', () => {
  afterEach(() => {
    resetSkillSchedulerForTests();
    vi.useRealTimers();
  });

  const fakeWindow = () => {
    const send = vi.fn();
    return { send, win: { isDestroyed: () => false, webContents: { send } } as unknown as Electron.BrowserWindow };
  };

  it('sends the list, then the due id, and checks every minute after', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule = saveSchedule(input({ timing: { kind: 'every', hours: 1 } }), 0);
    const { send, win } = fakeWindow();
    startSkillScheduler(() => win);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR);
    expect(send.mock.calls.map((c) => c[0])).toEqual([IPC.SKILL_SCHEDULES_CHANGED, IPC.SKILL_SCHEDULE_DUE]);
    expect(send).toHaveBeenLastCalledWith(IPC.SKILL_SCHEDULE_DUE, schedule.id);
  });

  it('takes nothing while there is no window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    saveSchedule(input({ timing: { kind: 'every', hours: 1 } }), 0);
    let win: Electron.BrowserWindow | null = null;
    startSkillScheduler(() => win);
    vi.advanceTimersByTime(HOUR);
    expect(saved.list?.[0].checkedThrough).toBe(0);
    const fake = fakeWindow();
    win = fake.win;
    vi.advanceTimersByTime(60_000);
    expect(fake.send).toHaveBeenCalledWith(IPC.SKILL_SCHEDULE_DUE, expect.any(String));
  });

  it('stays off once stopped, even if asked to start again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    saveSchedule(input({ timing: { kind: 'every', hours: 1 } }), 0);
    const { send, win } = fakeWindow();
    stopSkillScheduler();
    startSkillScheduler(() => win);
    vi.advanceTimersByTime(2 * HOUR);
    expect(send).not.toHaveBeenCalled();
  });

  it('notes a due run the window never answered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule = saveSchedule(input({ timing: { kind: 'every', hours: 1 } }), 0);
    const { send, win } = fakeWindow();
    startSkillScheduler(() => win);
    vi.advanceTimersByTime(HOUR);
    expect(send).toHaveBeenLastCalledWith(IPC.SKILL_SCHEDULE_DUE, schedule.id);
    vi.advanceTimersByTime(4 * 60_000);
    expect(saved.list![0].lastOutcome).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect(saved.list![0].lastOutcome?.error).toMatch(/didn't say it started a thread/);
    expect(send).toHaveBeenLastCalledWith(IPC.SKILL_SCHEDULES_CHANGED, saved.list);
  });

  it('leaves a due run the window answered alone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule = saveSchedule(input({ timing: { kind: 'every', hours: 1 } }), 0);
    const { win } = fakeWindow();
    startSkillScheduler(() => win);
    vi.advanceTimersByTime(HOUR);
    recordScheduleRun(schedule.id, { sessionId: 's1' }, HOUR + 1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(saved.list![0].lastOutcome).toEqual({ at: HOUR + 1, sessionId: 's1' });
  });
});
