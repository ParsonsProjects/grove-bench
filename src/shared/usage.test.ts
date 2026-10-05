import { describe, it, expect } from 'vitest';
import type { AgentEvent, ProviderUsage } from './types.js';
import { applyRateLimit, usageUpdatedAt, usageWindowLabel, windowHasReset } from './usage.js';

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
