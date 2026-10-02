export interface RateLimitState {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  utilization?: number;
  rateLimitType?: string;
}

/** Tracks the latest rate-limit status reported for each session. */
class RateLimitStore {
  bySession = $state<Record<string, RateLimitState>>({});

  /** The latest status, or null once its window has reset: history replay
   *  brings back old events, and a live one stops applying at its reset. */
  get(sessionId: string): RateLimitState | null {
    const state = this.bySession[sessionId];
    if (!state) return null;
    if (state.resetsAt && state.resetsAt * 1000 <= Date.now()) return null;
    return state;
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
