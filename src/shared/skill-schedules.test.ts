import { describe, it, expect } from 'vitest';
import { describeTiming, nextRunAt, parseTime, scheduleDueAt, scheduleNextRun, skillRunPrompt, type SkillSchedule } from './skill-schedules.js';

const HOUR = 3_600_000;
/** Local time, so the daily cases hold in any time zone. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const schedule = (over: Partial<SkillSchedule> = {}): SkillSchedule => ({
  id: 's1', repoPath: '/repo', agentId: 'claude-code', skill: 'triage', note: '', start: 'new', permissionMode: '',
  timing: { kind: 'every', hours: 2 }, maxOpen: 1, paused: false,
  scheduledFrom: 0, checkedThrough: 0, sessionIds: [], ...over,
});

describe('parseTime', () => {
  it('reads HH:MM and refuses anything else', () => {
    expect(parseTime('09:30')).toEqual({ hours: 9, minutes: 30 });
    expect(parseTime('7:05')).toEqual({ hours: 7, minutes: 5 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('noon')).toBeNull();
  });
});

describe('nextRunAt', () => {
  it('counts an every timing from its anchor, strictly after the given time', () => {
    const anchor = at(2026, 10, 22, 9);
    const every = { kind: 'every', hours: 2 } as const;
    expect(nextRunAt(every, anchor, anchor)).toBe(anchor + 2 * HOUR);
    expect(nextRunAt(every, anchor, anchor + 2 * HOUR)).toBe(anchor + 4 * HOUR);
    expect(nextRunAt(every, anchor, anchor + 5 * HOUR)).toBe(anchor + 6 * HOUR);
    // Before the anchor: the first time is still one step after it.
    expect(nextRunAt(every, anchor, anchor - 10 * HOUR)).toBe(anchor + 2 * HOUR);
    expect(nextRunAt({ kind: 'every', hours: 0 }, anchor, anchor)).toBeNull();
  });

  it('runs a daily timing at the next matching clock time', () => {
    const daily = { kind: 'daily', time: '09:00', weekdaysOnly: false } as const;
    expect(nextRunAt(daily, 0, at(2026, 10, 22, 8))).toBe(at(2026, 10, 22, 9));
    expect(nextRunAt(daily, 0, at(2026, 10, 22, 9))).toBe(at(2026, 10, 23, 9));
    expect(nextRunAt(daily, 0, at(2026, 10, 22, 10))).toBe(at(2026, 10, 23, 9));
  });

  it('skips Saturday and Sunday for weekdays only', () => {
    const weekdays = { kind: 'daily', time: '09:00', weekdaysOnly: true } as const;
    const friday = at(2026, 10, 23, 10);
    expect(new Date(friday).getDay()).toBe(5);
    const next = nextRunAt(weekdays, 0, friday)!;
    expect(new Date(next).getDay()).toBe(1);
    expect(next).toBe(at(2026, 10, 26, 9));
  });

  it('gives up on a time it cannot read', () => {
    expect(nextRunAt({ kind: 'daily', time: 'later', weekdaysOnly: false }, 0, 0)).toBeNull();
  });
});

describe('scheduleNextRun', () => {
  it('counts from the last time checked', () => {
    expect(scheduleNextRun(schedule({ checkedThrough: 90 * 60_000 }))).toBe(2 * HOUR);
  });

  it('has no next run while paused', () => {
    expect(scheduleNextRun(schedule({ paused: true }))).toBeNull();
  });
});

describe('scheduleDueAt', () => {
  it('gives the latest time since the last check, not the first', () => {
    expect(scheduleDueAt(schedule(), 7 * HOUR)).toBe(6 * HOUR);
    expect(scheduleDueAt(schedule(), 6 * HOUR)).toBe(6 * HOUR);
  });

  it('walks daily times day by day', () => {
    const daily = schedule({ timing: { kind: 'daily', time: '09:00', weekdaysOnly: true }, checkedThrough: at(2026, 10, 22, 10) });
    // Thursday 10:00 to Tuesday 12:00: Friday, Monday and Tuesday at 09:00 came; Tuesday is the latest.
    expect(scheduleDueAt(daily, at(2026, 10, 27, 12))).toBe(at(2026, 10, 27, 9));
  });

  it('is null before any time has come, and while paused', () => {
    expect(scheduleDueAt(schedule(), 2 * HOUR - 1)).toBeNull();
    expect(scheduleDueAt(schedule({ paused: true }), 10 * HOUR)).toBeNull();
  });
});

describe('describeTiming', () => {
  it('says the timing in a few words', () => {
    expect(describeTiming({ kind: 'every', hours: 1 })).toBe('Every hour');
    expect(describeTiming({ kind: 'every', hours: 4 })).toBe('Every 4 hours');
    expect(describeTiming({ kind: 'daily', time: '09:00', weekdaysOnly: true })).toBe('Weekdays at 09:00');
    expect(describeTiming({ kind: 'daily', time: '18:30', weekdaysOnly: false })).toBe('Daily at 18:30');
  });
});

describe('skillRunPrompt', () => {
  it('names the skill, with the note after it', () => {
    expect(skillRunPrompt({ skill: 'work-linear-issue', note: ' Take the top agent-ready issue. ' }))
      .toBe('Use the `work-linear-issue` skill for this task.\n\nTake the top agent-ready issue.');
  });

  it('sends the skill alone without a note', () => {
    expect(skillRunPrompt({ skill: 'triage', note: '  ' })).toBe('Use the `triage` skill.');
  });
});
