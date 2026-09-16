import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { usageStore, USAGE_REFRESH_MIN_AGE_MS } from './usage.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import type { AgentEvent, ProviderUsage } from '../../shared/types.js';

const SID = 's1';
const SNAPSHOT: ProviderUsage = {
  available: true,
  plan: 'max',
  fetchedAt: Date.now(),
  windows: [{ id: 'five_hour', label: '5-hour', utilization: 0.4, resetsAt: 1_900_000_000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  usageStore.byProvider = {};
  usageStore.loading = {};
  sessionStore.sessions = [{ id: SID, branch: 'b', repoPath: '/r', status: 'running', agentType: 'claude-code' }] as any;
  mockGroveBench.getUsage.mockResolvedValue(SNAPSHOT);
});

describe('usageStore.refresh', () => {
  it('fetches through the session and stores the result under its provider', async () => {
    await usageStore.refresh(SID);

    expect(mockGroveBench.getUsage).toHaveBeenCalledWith(SID);
    expect(usageStore.get('claude-code')).toEqual(SNAPSHOT);
    expect(usageStore.loading['claude-code']).toBe(false);
  });

  it('skips a refresh while the snapshot is fresh, and allows one when minAgeMs is lowered', async () => {
    await usageStore.refresh(SID);
    await usageStore.refresh(SID);
    expect(mockGroveBench.getUsage).toHaveBeenCalledTimes(1);

    usageStore.byProvider['claude-code'] = { ...SNAPSHOT, fetchedAt: Date.now() - USAGE_REFRESH_MIN_AGE_MS - 1 };
    await usageStore.refresh(SID);
    expect(mockGroveBench.getUsage).toHaveBeenCalledTimes(2);

    await usageStore.refresh(SID, { minAgeMs: 0 });
    expect(mockGroveBench.getUsage).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent refreshes into one fetch', async () => {
    await Promise.all([usageStore.refresh(SID), usageStore.refresh(SID)]);
    expect(mockGroveBench.getUsage).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous snapshot when the fetch returns null or throws', async () => {
    usageStore.byProvider['claude-code'] = { ...SNAPSHOT, fetchedAt: 0 };

    mockGroveBench.getUsage.mockResolvedValueOnce(null);
    await usageStore.refresh(SID);
    expect(usageStore.get('claude-code')?.plan).toBe('max');

    mockGroveBench.getUsage.mockRejectedValueOnce(new Error('boom'));
    await usageStore.refresh(SID);
    expect(usageStore.get('claude-code')?.plan).toBe('max');
    expect(usageStore.loading['claude-code']).toBe(false);
  });

  it('falls back to a shared default key for sessions without an agent type', () => {
    sessionStore.sessions = [{ id: 'old', branch: 'b', repoPath: '/r', status: 'stopped' }] as any;
    expect(usageStore.providerFor('old')).toBe('default');
    expect(usageStore.providerFor('missing')).toBe('default');
  });
});

describe('usageStore.applyRateLimitEvent', () => {
  const event = (over: Partial<Extract<AgentEvent, { type: 'rate_limit' }>>): Extract<AgentEvent, { type: 'rate_limit' }> =>
    ({ type: 'rate_limit', status: 'allowed', ...over });

  it('updates the matching window without touching fetchedAt', () => {
    usageStore.byProvider['claude-code'] = SNAPSHOT;

    usageStore.applyRateLimitEvent(SID, event({ rateLimitType: 'five_hour', utilization: 0.55, resetsAt: 1_900_000_500 }));

    const usage = usageStore.get('claude-code')!;
    expect(usage.windows[0]).toEqual({ id: 'five_hour', label: '5-hour', utilization: 0.55, resetsAt: 1_900_000_500 });
    expect(usage.fetchedAt).toBe(SNAPSHOT.fetchedAt);
  });

  it('adds an unknown window and seeds a snapshot when none exists', () => {
    usageStore.applyRateLimitEvent(SID, event({ rateLimitType: 'seven_day', utilization: 0.2 }));

    const usage = usageStore.get('claude-code')!;
    expect(usage.available).toBe(true);
    expect(usage.fetchedAt).toBe(0); // so the next refresh is not throttled
    expect(usage.windows).toEqual([{ id: 'seven_day', label: 'seven day', utilization: 0.2 }]);
  });

  it('ignores events without a window type or utilization', () => {
    usageStore.applyRateLimitEvent(SID, event({ status: 'rejected' }));
    usageStore.applyRateLimitEvent(SID, event({ rateLimitType: 'five_hour' }));
    expect(usageStore.get('claude-code')).toBeNull();
  });
});
