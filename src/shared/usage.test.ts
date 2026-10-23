import { describe, it, expect } from 'vitest';
import type { AgentEvent, ProviderUsage } from './types.js';
import { applyRateLimit, usageUpdatedAt, usageWindowLabel, windowHasReset, windowsReaching } from './usage.js';

const event = (over: Partial<Extract<AgentEvent, { type: 'rate_limit' }>>): Extract<AgentEvent, { type: 'rate_limit' }> =>
  ({ type: 'rate_limit', status: 'allowed', ...over });

describe('usageWindowLabel', () => {
  it('names the windows a full fetch names, and spells out the rest', () => {
    expect(usageWindowLabel('five_hour')).toBe('5-hour');
    expect(usageWindowLabel('seven_day_opus')).toBe('Weekly · Opus');
    expect(usageWindowLabel('seven_day_overage_included')).toBe('seven day overage included');
  });
});

describe('applyRateLimit', () => {
  const base: ProviderUsage = { available: true, plan: 'max', fetchedAt: 500, windows: [{ id: 'five_hour', label: '5-hour', utilization: 0.1 }] };

  it('returns the same snapshot for an event without a window or figure', () => {
    expect(applyRateLimit(base, event({ status: 'rejected' }))).toBe(base);
    expect(applyRateLimit(null, event({ rateLimitType: 'five_hour' }))).toBeNull();
  });

  it('updates a known window, keeps fetchedAt and stamps updatedAt', () => {
    const next = applyRateLimit(base, event({ rateLimitType: 'five_hour', utilization: 0.4, resetsAt: 99 }), 7000)!;
    expect(next.windows).toEqual([{ id: 'five_hour', label: '5-hour', utilization: 0.4, resetsAt: 99 }]);
    expect(next.fetchedAt).toBe(500);
    expect(next.updatedAt).toBe(7000);
    expect(usageUpdatedAt(next)).toBe(7000);
  });

  it('clamps the figure to 0..1', () => {
    expect(applyRateLimit(null, event({ rateLimitType: 'seven_day', utilization: 3 }))!.windows[0].utilization).toBe(1);
  });
});

describe('windowHasReset', () => {
  it('is true once the reset time has passed', () => {
    expect(windowHasReset({ id: 'w', label: 'w', utilization: 0.5, resetsAt: 10 }, 10_000)).toBe(true);
    expect(windowHasReset({ id: 'w', label: 'w', utilization: 0.5, resetsAt: 11 }, 10_000)).toBe(false);
    expect(windowHasReset({ id: 'w', label: 'w', utilization: 0.5 }, 10_000)).toBe(false);
  });
});

describe('windowsReaching', () => {
  const NOW = 1_800_000_000_000;
  const usage = (...windows: Array<[string, number, number?]>): ProviderUsage => ({
    available: true,
    fetchedAt: NOW,
    windows: windows.map(([id, utilization, resetsAt]) => ({ id, label: id, utilization, ...(resetsAt !== undefined ? { resetsAt } : {}) })),
  });
  const LATER = NOW / 1000 + 3600;
  const EARLIER = NOW / 1000 - 60;

  it('finds a window that rose to the alert level', () => {
    const reached = windowsReaching(usage(['five_hour', 0.7, LATER]), usage(['five_hour', 0.82, LATER], ['seven_day', 0.3, LATER]), 80, NOW);
    expect(reached.map((w) => w.id)).toEqual(['five_hour']);
  });

  it('ignores a window that was already over it', () => {
    expect(windowsReaching(usage(['five_hour', 0.85, LATER]), usage(['five_hour', 0.9, LATER]), 80, NOW)).toEqual([]);
  });

  it('counts a window over it with nothing known before, or reset since', () => {
    expect(windowsReaching(null, usage(['five_hour', 0.9, LATER]), 80, NOW)).toHaveLength(1);
    expect(windowsReaching(usage(['five_hour', 0.95, EARLIER]), usage(['five_hour', 0.9, LATER]), 80, NOW)).toHaveLength(1);
  });

  it('finds nothing with the alert off, usage unreported, or a window past its reset', () => {
    expect(windowsReaching(null, usage(['five_hour', 0.9, LATER]), 0, NOW)).toEqual([]);
    expect(windowsReaching(null, { ...usage(['five_hour', 0.9, LATER]), available: false }, 80, NOW)).toEqual([]);
    expect(windowsReaching(null, usage(['five_hour', 0.9, EARLIER]), 80, NOW)).toEqual([]);
  });
});
