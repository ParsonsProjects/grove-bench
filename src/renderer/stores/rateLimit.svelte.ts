export interface RateLimitState {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  utilization?: number;
  rateLimitType?: string;
}

/** Tracks the latest rate-limit status reported for each session. */
class RateLimitStore {
  bySession = $state<Record<string, RateLimitState>>({});

  get(sessionId: string): RateLimitState | null {
    return this.bySession[sessionId] ?? null;
  }

  set(sessionId: string, state: RateLimitState): void {
    this.bySession[sessionId] = state;
  }

  destroy(sessionId: string): void {
    const { [sessionId]: _drop, ...rest } = this.bySession;
    this.bySession = rest;
  }
}

export const rateLimitStore = new RateLimitStore();
