import { describe, it, expect, beforeEach, vi } from 'vitest';
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
