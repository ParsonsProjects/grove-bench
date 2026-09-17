import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { prStore } from './pr.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import type { PrInfo, SessionStatus } from '../../shared/types.js';

const SID = 'pr-test-session';

function pr(over: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 7,
    url: 'https://example.com/pull/7',
    state: 'OPEN',
    headSha: 'sha-1',
    checks: { total: 1, passed: 1, failed: 0, pending: 0 },
    failingChecks: [],
    commentSignature: [],
    ...over,
  };
}

function setStatus(status: SessionStatus) {
  sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status }];
}

async function refreshWith(info: PrInfo) {
  mockGroveBench.getPrInfo.mockResolvedValue(info);
  await prStore.refresh(SID, true);
}

beforeEach(() => {
  vi.clearAllMocks();
  prStore.clear(SID);
  sessionStore.needsAttention = {};
  sessionStore.activeSessionId = null;
});

describe('PR alert gating by session status', () => {
  it('alerts a running session about comments that arrived after the baseline', async () => {
    setStatus('running');
    await refreshWith(pr({ commentSignature: ['c1'] })); // seeds silently
    expect(prStore.getAlerts(SID)).toEqual([]);

    await refreshWith(pr({ commentSignature: ['c1', 'c2'] }));
    expect(prStore.getAlerts(SID)).toMatchObject([{ kind: 'new_comments', count: 1 }]);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pr_alert', sessionId: SID }),
    );
  });

  it('never alerts or notifies for a stopped session', async () => {
    setStatus('stopped');
    await refreshWith(pr({ commentSignature: ['c1'] }));
    await refreshWith(pr({
      commentSignature: ['c1', 'c2'],
      checks: { total: 1, passed: 0, failed: 1, pending: 0 },
      failingChecks: ['build'],
    }));
    expect(prStore.getAlerts(SID)).toEqual([]);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
    expect(sessionStore.needsAttention[SID]).toBeUndefined();
  });

  it('defers feedback that arrived while stopped and flags it once running again', async () => {
    setStatus('running');
    await refreshWith(pr({ commentSignature: ['c1'] })); // seeds

    setStatus('stopped');
    await refreshWith(pr({ commentSignature: ['c1', 'c2'] })); // detection skipped, state not advanced
    expect(prStore.getAlerts(SID)).toEqual([]);

    setStatus('running');
    await refreshWith(pr({ commentSignature: ['c1', 'c2'] }));
    expect(prStore.getAlerts(SID)).toMatchObject([{ kind: 'new_comments', count: 1 }]);
  });

  it('still records PR data for a stopped session (status bar display)', async () => {
    setStatus('stopped');
    const info = pr();
    await refreshWith(info);
    expect(prStore.getPr(SID)).toEqual(info);
  });
});

describe('refresh — partial failure', () => {
  it('keeps the last PR snapshot and flags it stale when the gh fetch fails', async () => {
    setStatus('running');
    await refreshWith(pr({ number: 7 }));
    expect(prStore.getPr(SID)?.number).toBe(7);

    mockGroveBench.getPrInfo.mockRejectedValue(new Error('gh pr view failed: timed out'));
    mockGroveBench.getGitSyncStatus.mockResolvedValue({ upstream: 'origin/feat/x', ahead: 2, behind: 0 });
    await prStore.refresh(SID, true);

    expect(prStore.getPr(SID)?.number).toBe(7);
    expect(prStore.fetchFailedBySession[SID]).toBe(true);
    // The local sync count is independent of gh and still lands.
    expect(prStore.getSync(SID).ahead).toBe(2);
  });

  it('clears the stale flag on the next successful fetch', async () => {
    setStatus('running');
    mockGroveBench.getPrInfo.mockRejectedValue(new Error('offline'));
    await prStore.refresh(SID, true);
    expect(prStore.fetchFailedBySession[SID]).toBe(true);

    await refreshWith(pr({ number: 8 }));
    expect(prStore.fetchFailedBySession[SID]).toBe(false);
    expect(prStore.getPr(SID)?.number).toBe(8);
  });

  it('still records a "no PR" answer as null', async () => {
    setStatus('running');
    await refreshWith(pr({ number: 7 }));
    mockGroveBench.getPrInfo.mockResolvedValue(null);
    await prStore.refresh(SID, true);
    expect(prStore.getPr(SID)).toBeNull();
    expect(prStore.fetchFailedBySession[SID]).toBeFalsy();
  });
});

describe('global sweep', () => {
  const A = 'sweep-a';
  const B = 'sweep-b';
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    sessionStore.sessions = [
      { id: A, branch: 'a', repoPath: 'C:/repo', status: 'running' },
      { id: B, branch: 'b', repoPath: 'C:/repo', status: 'running' },
    ];
    prStore.clear(A);
    prStore.clear(B);
  });

  afterEach(() => {
    prStore.stopGlobalPolling();
    vi.useRealTimers();
  });

  it('moves on to the next session when one fetch never resolves', async () => {
    mockGroveBench.getPrInfo.mockImplementation((id: string) =>
      id === A ? new Promise<never>(() => {}) : Promise.resolve(pr({ number: 42 })));
    prStore.startGlobalPolling(() => [A, B]);

    await vi.advanceTimersByTimeAsync(60_000); // first sweep starts; A hangs
    expect(prStore.getPr(B)).toBeNull();

    await vi.advanceTimersByTimeAsync(45_000); // per-session backstop fires
    expect(prStore.getPr(B)?.number).toBe(42);
  });

  it('re-arms the next sweep after a hung session instead of stopping for good', async () => {
    let calls = 0;
    mockGroveBench.getPrInfo.mockImplementation((id: string) => {
      calls++;
      return id === A ? new Promise<never>(() => {}) : Promise.resolve(pr());
    });
    prStore.startGlobalPolling(() => [A, B]);

    await vi.advanceTimersByTimeAsync(60_000 + 45_000); // sweep 1: A hangs, B done
    const afterFirst = calls;
    await vi.advanceTimersByTimeAsync(60_000 + 45_000); // sweep 2 must still run
    expect(calls).toBeGreaterThan(afterFirst);
  });

  it('skips sweeps while hidden and runs one immediately when shown again', async () => {
    mockGroveBench.getPrInfo.mockResolvedValue(pr({ number: 9 }));
    prStore.startGlobalPolling(() => [A]);

    hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGroveBench.getPrInfo).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGroveBench.getPrInfo).toHaveBeenCalledWith(A);
    expect(prStore.getPr(A)?.number).toBe(9);
  });
});
