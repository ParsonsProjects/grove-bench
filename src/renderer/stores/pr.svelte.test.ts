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

/** Refresh with one or more PRs (primary first, as main sorts them). */
async function refreshWith(...prs: PrInfo[]) {
  mockGroveBench.getPrs.mockResolvedValue(prs);
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

    mockGroveBench.getPrs.mockRejectedValue(new Error('gh pr list failed: timed out'));
    mockGroveBench.getGitSyncStatus.mockResolvedValue({ upstream: 'origin/feat/x', ahead: 2, behind: 0 });
    await prStore.refresh(SID, true);

    expect(prStore.getPr(SID)?.number).toBe(7);
    expect(prStore.fetchFailedBySession[SID]).toBe(true);
    // The local sync count is independent of gh and still lands.
    expect(prStore.getSync(SID).ahead).toBe(2);
  });

  it('clears the stale flag on the next successful fetch', async () => {
    setStatus('running');
    mockGroveBench.getPrs.mockRejectedValue(new Error('offline'));
    await prStore.refresh(SID, true);
    expect(prStore.fetchFailedBySession[SID]).toBe(true);

    await refreshWith(pr({ number: 8 }));
    expect(prStore.fetchFailedBySession[SID]).toBe(false);
    expect(prStore.getPr(SID)?.number).toBe(8);
  });

  it('still records a "no PR" answer as null', async () => {
    setStatus('running');
    await refreshWith(pr({ number: 7 }));
    await refreshWith();
    expect(prStore.getPr(SID)).toBeNull();
    expect(prStore.getPrs(SID)).toEqual([]);
    expect(prStore.fetchFailedBySession[SID]).toBeFalsy();
  });
});

describe('multiple PRs per session', () => {
  const open = () => pr({ number: 50, state: 'OPEN', headRefName: 'feat/x', baseRefName: 'main', commentSignature: ['c50'] });
  const merged = () => pr({ number: 41, state: 'MERGED', headRefName: 'feat/x', baseRefName: 'main', commentSignature: ['c41'] });
  const stacked = () => pr({ number: 52, state: 'OPEN', headRefName: 'feat/x-part-2', baseRefName: 'feat/x', commentSignature: ['c52'] });

  it('follows the first (main-sorted) PR as primary and lists the rest', async () => {
    setStatus('running');
    await refreshWith(open(), merged());
    expect(prStore.getPr(SID)?.number).toBe(50);
    expect(prStore.getPrs(SID).map((p) => p.number)).toEqual([50, 41]);
  });

  it('lets the user pick another PR as primary and forgets the pick once it is gone', async () => {
    setStatus('running');
    await refreshWith(open(), merged());
    prStore.setPrimary(SID, 41);
    expect(prStore.getPr(SID)?.number).toBe(41);

    prStore.setPrimary(SID, 999); // unknown → ignored
    expect(prStore.getPr(SID)?.number).toBe(41);

    await refreshWith(open()); // 41 dropped off the list → back to the head
    expect(prStore.getPr(SID)?.number).toBe(50);
  });

  it('only watches the primary PR: feedback on another PR raises no alert', async () => {
    setStatus('running');
    await refreshWith(open(), stacked()); // seeds #50 only
    await refreshWith(open(), pr({ ...stacked(), commentSignature: ['c52', 'c52b'] }));
    expect(prStore.getAlerts(SID)).toEqual([]);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('seeds a newly chosen primary from its current feedback instead of replaying it', async () => {
    setStatus('running');
    await refreshWith(open(), pr({ ...stacked(), commentSignature: ['c52', 'c52b'] }));
    prStore.setPrimary(SID, 52); // seeds #52 silently
    expect(prStore.getAlerts(SID)).toEqual([]);

    await refreshWith(open(), pr({ ...stacked(), commentSignature: ['c52', 'c52b', 'c52c'] }));
    expect(prStore.getAlerts(SID)).toMatchObject([{ kind: 'new_comments', count: 1, prNumber: 52 }]);
  });

  it('keeps alerts with their PR: switching primary hides them, switching back shows them', async () => {
    setStatus('running');
    await refreshWith(open(), stacked());
    await refreshWith(pr({ ...open(), commentSignature: ['c50', 'c50b'] }), stacked());
    expect(prStore.getAlerts(SID)).toMatchObject([{ kind: 'new_comments', prNumber: 50 }]);

    prStore.setPrimary(SID, 52);
    expect(prStore.getAlerts(SID)).toEqual([]);
    prStore.setPrimary(SID, 50);
    expect(prStore.getAlerts(SID)).toMatchObject([{ kind: 'new_comments', prNumber: 50 }]);
  });

  it('remembers each PR\'s own baseline across primary switches', async () => {
    setStatus('running');
    await refreshWith(open(), stacked()); // #50 seeded with c50
    prStore.setPrimary(SID, 52); // #52 seeded with c52
    prStore.setPrimary(SID, 50);
    await refreshWith(open(), stacked()); // nothing new on #50
    expect(prStore.getAlerts(SID)).toEqual([]);
  });

  it('addresses the primary PR on its own head branch, not the session branch', async () => {
    setStatus('running');
    await refreshWith(stacked(), open());
    mockGroveBench.getPrReviewComments.mockResolvedValue([
      { id: 'r1', author: 'reviewer', authorAssociation: 'MEMBER', body: 'please rename this' },
    ]);
    expect(await prStore.addressReviewsWithAgent(SID)).toBe('sent');
    expect(mockGroveBench.getPrReviewComments).toHaveBeenCalledWith(SID, 52);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, expect.stringContaining('PR #52 for this branch (feat/x-part-2)'));
  });

  it('makes a PR created from the app the primary, ahead of any pick', async () => {
    setStatus('running');
    await refreshWith(open(), merged());
    prStore.setPrimary(SID, 41);
    mockGroveBench.createPr.mockResolvedValue(pr({ number: 60, state: 'OPEN' }));
    await prStore.createPr(SID, { title: 't', body: 'b', base: 'main' });
    expect(prStore.getPr(SID)?.number).toBe(60);
    expect(prStore.getPrs(SID).map((p) => p.number)).toEqual([60, 50, 41]);
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
    mockGroveBench.getPrs.mockImplementation((id: string) =>
      id === A ? new Promise<never>(() => {}) : Promise.resolve([pr({ number: 42 })]));
    prStore.startGlobalPolling(() => [A, B]);

    await vi.advanceTimersByTimeAsync(60_000); // first sweep starts; A hangs
    expect(prStore.getPr(B)).toBeNull();

    await vi.advanceTimersByTimeAsync(45_000); // per-session backstop fires
    expect(prStore.getPr(B)?.number).toBe(42);
  });

  it('re-arms the next sweep after a hung session instead of stopping for good', async () => {
    let calls = 0;
    mockGroveBench.getPrs.mockImplementation((id: string) => {
      calls++;
      return id === A ? new Promise<never>(() => {}) : Promise.resolve([pr()]);
    });
    prStore.startGlobalPolling(() => [A, B]);

    await vi.advanceTimersByTimeAsync(60_000 + 45_000); // sweep 1: A hangs, B done
    const afterFirst = calls;
    await vi.advanceTimersByTimeAsync(60_000 + 45_000); // sweep 2 must still run
    expect(calls).toBeGreaterThan(afterFirst);
  });

  it('skips sweeps while hidden and runs one immediately when shown again', async () => {
    mockGroveBench.getPrs.mockResolvedValue([pr({ number: 9 })]);
    prStore.startGlobalPolling(() => [A]);

    hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGroveBench.getPrs).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGroveBench.getPrs).toHaveBeenCalledWith(A);
    expect(prStore.getPr(A)?.number).toBe(9);
  });
});
