import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { planAlertStore } from '../stores/planAlerts.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { store as sessionStore } from '../stores/sessions.svelte.js';

import PlanUsageToast from './PlanUsageToast.svelte';

const RESET = Math.round(Date.now() / 1000) + 3600;

// jsdom has no Web Animations; the toast flies in and out with them.
const realAnimate = Element.prototype.animate;
beforeEach(() => {
  Element.prototype.animate = vi.fn(() => ({ onfinish: null, cancel() {}, finish() {}, currentTime: 0 }) as unknown as Animation);
  planAlertStore.reset();
  sessionStore.sessions = [{ id: 's1', branch: 'b', repoPath: '/r', status: 'running', agentType: 'claude-code' }] as any;
  sessionStore.activeSessionId = 's1';
});

afterEach(() => {
  cleanup();
  Element.prototype.animate = realAnimate;
});

describe('PlanUsageToast', () => {
  it('shows what reached the alert level as a warning, with when it resets', () => {
    planAlertStore.alert = { providerId: 'claude-code', sessionId: 's1', windows: [{ label: '5-hour', percent: 83, resetsAt: RESET }] };
    render(PlanUsageToast);

    expect(screen.getByRole('status')).toHaveTextContent('5-hour usage at 83%');
    expect(screen.getByText(/· resets /)).toBeInTheDocument();
  });

  it('names each window\'s reset when several reached it', () => {
    planAlertStore.alert = {
      providerId: 'claude-code', sessionId: 's1',
      windows: [{ label: '5-hour', percent: 81, resetsAt: RESET }, { label: 'Weekly', percent: 80, resetsAt: RESET }],
    };
    render(PlanUsageToast);

    expect(screen.getByText('5-hour usage at 81%, Weekly usage at 80%')).toBeInTheDocument();
    expect(screen.getByText(/5-hour resets .* · Weekly resets /)).toBeInTheDocument();
  });

  const alertNow = () => {
    planAlertStore.alert = { providerId: 'claude-code', sessionId: 's1', windows: [{ label: '5-hour', percent: 83 }] };
  };

  it('View usage opens the thread\'s usage figures', async () => {
    alertNow();
    render(PlanUsageToast);
    await fireEvent.click(screen.getByRole('button', { name: 'View usage' }));
    expect(planAlertStore.alert).toBeNull();
    await vi.waitFor(() => expect(planAlertStore.usageRequest).toBe('s1'));
  });

  it('Alert level opens Settings at Limits & alerts', async () => {
    alertNow();
    render(PlanUsageToast);
    await fireEvent.click(screen.getByRole('button', { name: 'Alert level' }));
    expect(planAlertStore.alert).toBeNull();
    expect(settingsStore.panelOpen).toBe(true);
    expect(settingsStore.requestedSection).toBe('limits');
  });

  it('can be dismissed', async () => {
    alertNow();
    render(PlanUsageToast);
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(planAlertStore.alert).toBeNull();
  });
});
