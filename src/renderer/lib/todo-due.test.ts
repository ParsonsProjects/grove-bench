import { describe, it, expect } from 'vitest';
import { isDue, dueFromPick, dueFromInputs, dateInputValue, timeInputValue, dueText } from './todo-due.js';

// Local times, so the tests hold in any time zone. Monday 17 November 2025.
const MON_NOON = new Date(2025, 10, 17, 12, 0).getTime();
const day = (d: number, h = 0, m = 0) => new Date(2025, 10, d, h, m).getTime();

describe('dueFromPick', () => {
  it('tomorrow is the start of the next day, with no time', () => {
    expect(dueFromPick('tomorrow', MON_NOON)).toEqual({ at: day(18), timed: false });
  });

  it('next week is the next Monday, a week on when today is Monday', () => {
    expect(dueFromPick('next-week', MON_NOON).at).toBe(day(24));
    expect(dueFromPick('next-week', day(19, 15)).at).toBe(day(24));
    expect(dueFromPick('next-week', day(23, 9)).at).toBe(day(24));
  });
});

describe('dueFromInputs', () => {
  it('a date alone is due from the start of that day', () => {
    expect(dueFromInputs('2025-11-18', '')).toEqual({ at: day(18), timed: false });
  });

  it('a time makes it timed', () => {
    expect(dueFromInputs('2025-11-18', '09:30')).toEqual({ at: day(18, 9, 30), timed: true });
  });

  it('no date, or a bad one, is no due date', () => {
    expect(dueFromInputs('', '09:30')).toBeUndefined();
    expect(dueFromInputs('18/11/2025', '')).toBeUndefined();
  });

  it('round-trips through the input values', () => {
    const at = day(18, 9, 5);
    expect(dueFromInputs(dateInputValue(at), timeInputValue(at))).toEqual({ at, timed: true });
  });
});

describe('isDue', () => {
  it('a date-only To do is due all of that day', () => {
    expect(isDue({ at: day(17), timed: false }, MON_NOON)).toBe(true);
    expect(isDue({ at: day(18), timed: false }, MON_NOON)).toBe(false);
  });

  it('a timed one is due from its time', () => {
    expect(isDue({ at: day(17, 13), timed: true }, MON_NOON)).toBe(false);
    expect(isDue({ at: day(17, 11), timed: true }, MON_NOON)).toBe(true);
    expect(isDue(undefined, MON_NOON)).toBe(false);
  });
});

describe('dueText', () => {
  it('says when it is due, then that it is due or overdue', () => {
    expect(dueText({ at: day(18), timed: false }, MON_NOON)).toBe('Due tomorrow');
    expect(dueText({ at: day(17), timed: false }, MON_NOON)).toBe('Due today');
    expect(dueText({ at: day(16), timed: false }, MON_NOON)).toBe('Overdue since yesterday');
    expect(dueText({ at: day(17, 9), timed: true }, MON_NOON)).toMatch(/^Due since 9:00/);
    expect(dueText({ at: day(18, 9), timed: true }, MON_NOON)).toMatch(/^Due tomorrow 9:00/);
  });
});
