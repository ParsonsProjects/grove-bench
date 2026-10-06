import type { AgentEvent, ProviderUsage, UsageWindow } from './types.js';

type RateLimitEvent = Extract<AgentEvent, { type: 'rate_limit' }>;

/** Labels for the plan windows Claude reports, shared by full fetches and the
 *  rate-limit events in between so a window reads the same either way. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  extra_usage: 'Extra usage',
};

export function usageWindowLabel(id: string): string {
  return WINDOW_LABELS[id] ?? id.replace(/_/g, ' ');
}

/**
 * Fold a rate-limit event into a provider's usage snapshot: updates the
 * matching window (or adds one) and stamps `updatedAt`, leaving `fetchedAt`
 * alone so the next full fetch still happens. Returns `current` unchanged when
 * the event carries no utilization or window.
 */
export function applyRateLimit(current: ProviderUsage | null, event: RateLimitEvent, now = Date.now()): ProviderUsage | null {
  if (event.utilization === undefined || !event.rateLimitType) return current;
  const incoming: UsageWindow = {
    id: event.rateLimitType,
    label: usageWindowLabel(event.rateLimitType),
    utilization: Math.max(0, Math.min(1, event.utilization)),
    ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}),
  };
  if (!current) return { available: true, windows: [incoming], fetchedAt: 0, updatedAt: now };
  const known = current.windows.some((w) => w.id === incoming.id);
  const windows = known
    ? current.windows.map((w) => w.id === incoming.id
      ? { ...w, utilization: incoming.utilization, resetsAt: incoming.resetsAt ?? w.resetsAt }
      : w)
    : [...current.windows, incoming];
  return { ...current, available: true, windows, updatedAt: now };
}

/** When the snapshot last changed, by a full fetch or a rate-limit event. */
export function usageUpdatedAt(usage: ProviderUsage): number {
  return Math.max(usage.fetchedAt, usage.updatedAt ?? 0);
}

/** True once a window's reset time has passed: its figure is from before
 *  the reset, so it no longer says how much is used. */
export function windowHasReset(window: UsageWindow, now = Date.now()): boolean {
  return window.resetsAt !== undefined && window.resetsAt * 1000 <= now;
}
