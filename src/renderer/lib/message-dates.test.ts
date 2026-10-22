import { describe, it, expect } from 'vitest';
import { dayDividers, dayLabel, dayStart, formatSentTime } from './message-dates.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

// Local times, so the tests hold in any timezone.
const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const TODAY = dayStart(at(10, 22));

const prompt = (id: string, sentAt?: number): ChatMessage => ({ kind: 'user', id, text: id, ...(sentAt !== undefined ? { sentAt } : {}) });
const reply = (id: string): ChatMessage => ({ kind: 'text', id, text: id, uuid: id });

describe('dayStart', () => {
  it('is local midnight of the same day', () => {
    expect(dayStart(at(10, 22, 23, 59))).toBe(new Date(2026, 9, 22).getTime());
    expect(dayStart(at(10, 22, 0, 0))).toBe(new Date(2026, 9, 22).getTime());
  });
});

describe('dayLabel', () => {
  it('says Today and Yesterday', () => {
    expect(dayLabel(at(10, 22, 0, 1), TODAY)).toBe('Today');
    expect(dayLabel(at(10, 21, 23, 59), TODAY)).toBe('Yesterday');
  });

  it('gives the date, with its year, further back', () => {
    const label = dayLabel(at(10, 20), TODAY);
    expect(label).toBe(new Date(at(10, 20)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    expect(label).toContain('2026');
  });

  it('counts Yesterday across the start of a month', () => {
    expect(dayLabel(at(9, 30), dayStart(at(10, 1)))).toBe('Yesterday');
  });
});

describe('formatSentTime', () => {
  it('is the clock time in the user locale', () => {
    expect(formatSentTime(at(10, 22, 14, 32))).toBe(new Date(at(10, 22, 14, 32)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  });
});

describe('dayDividers', () => {
  it('puts one above the first prompt of each day', () => {
    const msgs = [
      prompt('a', at(10, 21, 9)),
      reply('r1'),
      prompt('b', at(10, 21, 16)),
      prompt('c', at(10, 22, 8)),
      reply('r2'),
    ];
    expect([...dayDividers(msgs, TODAY)]).toEqual([['a', 'Yesterday'], ['c', 'Today']]);
  });

  it('passes over prompts with no time, so older history gets none', () => {
    const msgs = [prompt('old1'), prompt('old2'), prompt('new', at(10, 22, 9)), prompt('later', at(10, 22, 10))];
    expect([...dayDividers(msgs, TODAY)]).toEqual([['new', 'Today']]);
  });

  it('is empty when nothing has a time', () => {
    expect(dayDividers([prompt('a'), reply('r')], TODAY).size).toBe(0);
  });
});
