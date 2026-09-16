import type { AgentEvent, ProviderUsage, UsageWindow } from '../../shared/types.js';
import { store as sessionStore } from './sessions.svelte.js';

/** Don't re-fetch a provider's usage more often than this unless forced. */
export const USAGE_REFRESH_MIN_AGE_MS = 60_000;

/** Key used for sessions whose adapter id is not known yet. */
const DEFAULT_PROVIDER = 'default';

/**
 * Account-level plan usage ("runway") per provider. Fed two ways: a full
 * fetch through the adapter (popover open, after a turn — throttled), and the
 * rate-limit headers that ride along with every response, which update the
 * matching window in between fetches.
 */
class UsageStore {
  byProvider = $state<Record<string, ProviderUsage>>({});
  loading = $state<Record<string, boolean>>({});
  private inflight: Record<string, Promise<void> | undefined> = {};

  get(providerId: string): ProviderUsage | null {
    return this.byProvider[providerId] ?? null;
  }

  /** The provider key for a session: its adapter id, or the shared default
   *  before that is known (demo data, sessions restored while stopped). */
  providerFor(sessionId: string): string {
    return sessionStore.sessions.find((s) => s.id === sessionId)?.agentType || DEFAULT_PROVIDER;
  }

  /**
   * Fetch usage through `sessionId` for its provider. Skipped while a fetch is
   * in flight or when the snapshot is younger than `minAgeMs`.
   */
  async refresh(sessionId: string, opts: { minAgeMs?: number; providerId?: string } = {}): Promise<void> {
    const providerId = opts.providerId ?? this.providerFor(sessionId);
    const minAge = opts.minAgeMs ?? USAGE_REFRESH_MIN_AGE_MS;
    const existing = this.byProvider[providerId];
    if (existing && Date.now() - existing.fetchedAt < minAge) return;
    if (this.inflight[providerId]) return this.inflight[providerId];

    this.loading[providerId] = true;
    const run = (async () => {
      try {
        const usage = await window.groveBench.getUsage(sessionId);
        if (usage) this.byProvider[providerId] = usage;
      } catch (e) {
        console.warn('[usage] refresh failed:', e);
      } finally {
        this.loading[providerId] = false;
        delete this.inflight[providerId];
      }
    })();
    this.inflight[providerId] = run;
    return run;
  }

  /**
   * Fold a live rate-limit event into the provider's snapshot. Updates the
   * matching window (or adds one) so the popover stays current between
   * fetches; leaves fetchedAt alone so the next full refresh still happens.
   */
  applyRateLimitEvent(sessionId: string, event: Extract<AgentEvent, { type: 'rate_limit' }>): void {
    if (event.utilization === undefined || !event.rateLimitType) return;
    const providerId = this.providerFor(sessionId);
    const incoming: UsageWindow = {
      id: event.rateLimitType,
      label: event.rateLimitType.replace(/_/g, ' '),
      utilization: Math.max(0, Math.min(1, event.utilization)),
      ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}),
    };
    const current = this.byProvider[providerId];
    if (!current) {
      this.byProvider[providerId] = { available: true, windows: [incoming], fetchedAt: 0 };
      return;
    }
    const known = current.windows.some((w) => w.id === incoming.id);
    const windows = known
      ? current.windows.map((w) => w.id === incoming.id
        ? { ...w, utilization: incoming.utilization, resetsAt: incoming.resetsAt ?? w.resetsAt }
        : w)
      : [...current.windows, incoming];
    this.byProvider[providerId] = { ...current, available: true, windows };
  }
}

export const usageStore = new UsageStore();
