import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { planAlertStore } from './planAlerts.svelte.js';
import { usageStore } from './usage.svelte.js';
import { settingsStore } from './settings.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import type { ProviderUsage } from '../../shared/types.js';

const SID = 's1';
const RESET = Math.round(Date.now() / 1000) + 3600;
const usage = (utilization: number): ProviderUsage => ({
  available: true,
  plan: 'max',
  fetchedAt: Date.now(),
  windows: [{ id: 'five_hour', label: '5-hour', utilization, resetsAt: RESET }],
});

beforeEach(() => {
  vi.clearAllMocks();
  usageStore.reset();
  planAlertStore.reset();
  settingsStore.current = { ...settingsStore.current, planUsageAlertPercent: 80 };
  sessionStore.sessions = [{ id: SID, branch: 'b', repoPath: '/r', status: 'running', agentType: 'claude-code' }] as any;
});

describe('planAlertStore', () => {
  it('alerts in the app and on the desktop when a fetch shows a window reaching the level', async () => {
    usageStore.byProvider['claude-code'] = { ...usage(0.6), fetchedAt: 0 };
    mockGroveBench.getUsage.mockResolvedValue(usage(0.83));
    await usageStore.refresh(SID);

    expect(planAlertStore.alert).toMatchObject({ providerId: 'claude-code' });
    expect(planAlertStore.alert!.text).toMatch(/^5-hour window at 83%, resets /);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plan_usage', sessionId: SID }));
  });

  it('alerts once per window until it resets', () => {
    planAlertStore.check('claude-code', SID, usage(0.5), usage(0.81));
    planAlertStore.dismiss();
    planAlertStore.check('claude-code', SID, usage(0.79), usage(0.82));
    expect(planAlertStore.alert).toBeNull();
    expect(mockGroveBench.notify).toHaveBeenCalledTimes(1);
  });

  it('alerts from a live rate-limit event', () => {
    usageStore.byProvider['claude-code'] = usage(0.7);
    usageStore.applyRateLimitEvent(SID, { type: 'rate_limit', status: 'allowed_warning', utilization: 0.9, rateLimitType: 'five_hour' });
    expect(planAlertStore.alert?.text).toMatch(/^5-hour window at 90%/);
  });

  it('stays quiet with the alert turned off', () => {
    settingsStore.current = { ...settingsStore.current, planUsageAlertPercent: 0 };
    planAlertStore.check('claude-code', SID, usage(0.5), usage(0.95));
    expect(planAlertStore.alert).toBeNull();
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });
});
