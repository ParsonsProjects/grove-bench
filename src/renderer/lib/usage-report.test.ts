import { describe, it, expect } from 'vitest';
import { formatAgentTime, rangeSince } from './usage-report.js';

describe('rangeSince', () => {
  const now = new Date(2026, 10, 17, 15, 30).getTime();

  it('starts today at local midnight', () => {
    expect(rangeSince('today', now)).toBe(new Date(2026, 10, 17).getTime());
  });

  it('counts today among the days of a longer range', () => {
    expect(rangeSince('week', now)).toBe(new Date(2026, 10, 11).getTime());
    expect(rangeSince('month', now)).toBe(new Date(2026, 9, 19).getTime());
  });

  it('has no start for all time', () => {
    expect(rangeSince('all', now)).toBeNull();
  });
});

describe('formatAgentTime', () => {
  it('reads as seconds, minutes, or hours and minutes', () => {
    expect(formatAgentTime(0)).toBe('0s');
    expect(formatAgentTime(42_400)).toBe('42s');
    expect(formatAgentTime(12 * 60_000 + 20_000)).toBe('12m');
    expect(formatAgentTime(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatAgentTime(-5)).toBe('0s');
  });
});
