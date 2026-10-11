import type { ProviderUsage } from '../../shared/types.js';
import { windowsReaching } from '../../shared/usage.js';
import { formatResetTime } from '../lib/reset-time.js';
import { notifyOs } from '../lib/os-notify.js';
import { settingsStore } from './settings.svelte.js';

export interface PlanAlert {
  providerId: string;
  /** What reached the alert level, e.g. "5-hour window at 82%, resets 3:40 PM". */
  text: string;
}

/**
 * The plan usage alert (Settings > Limits & alerts): once a plan window
 * reaches the alert level, say so in the app and, while the window isn't
 * focused, as a desktop notification. Once per window until it resets, and
 * only for a rise seen this run, so figures saved from last time don't
 * alert again at launch.
 */
class PlanAlertStore {
  alert = $state<PlanAlert | null>(null);
  /** provider, window and reset time already alerted. */
  private alerted = new Set<string>();

  /** Compare a provider's usage before and after an update. `sessionId` is
   *  the thread the figures came through, opened when the notification is
   *  clicked. */
  check(providerId: string, sessionId: string, prev: ProviderUsage | null, next: ProviderUsage, now = Date.now()): void {
    const reached = windowsReaching(prev, next, settingsStore.current.planUsageAlertPercent, now)
      .filter((w) => !this.alerted.has(`${providerId}:${w.id}:${w.resetsAt ?? ''}`));
    if (reached.length === 0) return;
    for (const w of reached) this.alerted.add(`${providerId}:${w.id}:${w.resetsAt ?? ''}`);
    const text = reached
      .map((w) => `${w.label} window at ${Math.round(w.utilization * 100)}%${w.resetsAt ? `, resets ${formatResetTime(w.resetsAt, now)}` : ''}`)
      .join('; ');
    this.alert = { providerId, text };
    notifyOs('plan_usage', sessionId, `Plan usage: ${text}`);
  }

  dismiss(): void {
    this.alert = null;
  }

  /** Forget what was alerted (tests). */
  reset(): void {
    this.alert = null;
    this.alerted.clear();
  }
}

export const planAlertStore = new PlanAlertStore();
