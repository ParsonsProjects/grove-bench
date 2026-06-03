import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimitStore } from './rateLimit.svelte.js';

const SID = 'test-session';

beforeEach(() => {
  rateLimitStore.bySession = {};
});

describe('rateLimitStore', () => {
  it('returns null for unknown sessions', () => {
    expect(rateLimitStore.get('unknown')).toBeNull();
  });

  it('stores and returns rate limit state', () => {
    rateLimitStore.set(SID, { status: 'allowed_warning', utilization: 0.85 });
    const rl = rateLimitStore.get(SID);
    expect(rl!.status).toBe('allowed_warning');
    expect(rl!.utilization).toBe(0.85);
  });

  it('overwrites prior state on set', () => {
    rateLimitStore.set(SID, { status: 'allowed_warning', utilization: 0.85 });
    rateLimitStore.set(SID, { status: 'rejected', rateLimitType: 'token' });
    const rl = rateLimitStore.get(SID);
    expect(rl!.status).toBe('rejected');
    expect(rl!.rateLimitType).toBe('token');
    expect(rl!.utilization).toBeUndefined();
  });

  it('destroy clears state for a session', () => {
    rateLimitStore.set(SID, { status: 'rejected' });
    rateLimitStore.destroy(SID);
    expect(rateLimitStore.get(SID)).toBeNull();
    expect(rateLimitStore.bySession[SID]).toBeUndefined();
  });
});
