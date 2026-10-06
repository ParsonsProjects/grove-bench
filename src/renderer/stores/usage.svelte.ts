import type { AgentEvent, ProviderUsage } from '../../shared/types.js';
import { applyRateLimit } from '../../shared/usage.js';
import { store as sessionStore } from './sessions.svelte.js';

/** Don't re-fetch a provider's usage more often than this unless forced. */
export const USAGE_REFRESH_MIN_AGE_MS = 60_000;

/** Key used for sessions whose adapter id is not known yet. */
const DEFAULT_PROVIDER = 'default';

/**
 * Account-level plan usage ("runway") per provider. Fed three ways: a full
 * fetch through the adapter (popover open, after a turn — throttled), the
 * rate-limit headers that ride along with every response, which update the
 * matching window in between fetches, and the snapshot main saved last time,
 * so a conversation that hasn't connected yet (or the first one after a
 * restart) still shows the last known figures.
 */
class UsageStore {
  byProvider = $state<Record<string, ProviderUsage>>({});
  loading = $state<Record<string, boolean>>({});
  private inflight: Record<string, Promise<void> | undefined> = {};
  private cachedAsked = new Set<string>();

  /** Forget everything, saved snapshots included (tests). */
  reset(): void {
    this.byProvider = {};
    this.loading = {};
    this.inflight = {};
    this.cachedAsked.clear();
  }

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
    await this.loadCached(providerId);
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
   * Seed a provider with the snapshot main saved, once per provider and only
   * when nothing newer is here yet. Covers drafts, which have no session to
   * fetch through.
   */
  async loadCached(providerId: string): Promise<void> {
    if (this.byProvider[providerId] || this.cachedAsked.has(providerId)) return;
    this.cachedAsked.add(providerId);
    try {
      const cached = await window.groveBench.getCachedUsage(providerId);
      if (cached && !this.byProvider[providerId]) this.byProvider[providerId] = cached;
    } catch (e) {
      console.warn('[usage] cached snapshot failed:', e);
    }
  }

  /**
   * Fold a live rate-limit event into the provider's snapshot. Updates the
   * matching window (or adds one) so the popover stays current between
   * fetches; leaves fetchedAt alone so the next full refresh still happens.
   * Only for live events: one replayed from an old conversation's history
   * would put back figures from before.
   */
  applyRateLimitEvent(sessionId: string, event: Extract<AgentEvent, { type: 'rate_limit' }>): void {
    const providerId = this.providerFor(sessionId);
    const current = this.byProvider[providerId] ?? null;
    const next = applyRateLimit(current, event);
    if (next && next !== current) this.byProvider[providerId] = next;
  }
}

export const usageStore = new UsageStore();
