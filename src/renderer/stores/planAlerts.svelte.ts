import type { ProviderUsage } from '../../shared/types.js';
import { windowsReaching } from '../../shared/usage.js';
import { formatResetTime } from '../lib/reset-time.js';
import { notifyOs } from '../lib/os-notify.js';
import { settingsStore } from './settings.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';

export interface PlanAlertWindow {
  label: string;
  /** Whole percent used. */
  percent: number;
  /** Epoch seconds. */
  resetsAt?: number;
}

export interface PlanAlert {
  providerId: string;
  /** The thread the figures came through. */
  sessionId: string;
  windows: PlanAlertWindow[];
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
  /** A thread whose agent settings should open at Usage (View usage). Its
   *  popover opens itself and clears this. */
  usageRequest = $state<string | null>(null);
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
    const windows = reached.map((w) => ({
      label: w.label,
      percent: Math.round(w.utilization * 100),
      ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}),
    }));
    this.alert = { providerId, sessionId, windows };
    const body = windows
      .map((w) => `${w.label} at ${w.percent}%${w.resetsAt ? `, resets ${formatResetTime(w.resetsAt, now)}` : ''}`)
      .join('; ');
    notifyOs('plan_usage', sessionId, `Plan usage: ${body}`);
  }

  /** Open the usage figures behind the alert: the agent settings of the
   *  thread in front, when it uses the same agent, else of the thread the
   *  figures came through, switching to it. */
  viewUsage(): void {
    const alert = this.alert;
    if (!alert) return;
    this.alert = null;
    const active = sessionStore.activeSessionId;
    const activeAgent = sessionStore.sessions.find((s) => s.id === active)?.agentType;
    const target = active && activeAgent === alert.providerId ? active : alert.sessionId;
    if (!sessionStore.sessions.some((s) => s.id === target)) return;
    sessionStore.activeSessionId = target;
    // After this click has finished: the popover closes on clicks outside it.
    setTimeout(() => { this.usageRequest = target; }, 0);
  }

  dismiss(): void {
    this.alert = null;
  }

  /** Forget what was alerted (tests). */
  reset(): void {
    this.alert = null;
    this.usageRequest = null;
    this.alerted.clear();
  }
}

export const planAlertStore = new PlanAlertStore();
