import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { followUpsStore } from './followUps.svelte.js';
import type { FollowUp } from '../../shared/follow-ups.js';

function fu(id: string, repoPath: string, extra: Partial<FollowUp> = {}): FollowUp {
  return { id, repoPath, title: id, details: '', createdAt: 0, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  followUpsStore.list = [];
  followUpsStore.ready = false;
  followUpsStore.drawerOpen = false;
});

describe('followUpsStore.load', () => {
  it('loads the list and counts the open ones', async () => {
    mockGroveBench.listFollowUps.mockResolvedValueOnce([fu('a', '/r'), fu('b', '/r', { doneAt: 1 })]);
    await followUpsStore.load(0);
    expect(followUpsStore.ready).toBe(true);
    expect(followUpsStore.list.map((f) => f.id)).toEqual(['a', 'b']);
    expect(followUpsStore.openCount).toBe(1);
  });

  it("asks again while the file can't be read", async () => {
    mockGroveBench.listFollowUps.mockResolvedValueOnce(null).mockResolvedValueOnce([fu('a', '/r')]);
    await followUpsStore.load(0);
    expect(mockGroveBench.listFollowUps).toHaveBeenCalledTimes(2);
    expect(followUpsStore.list).toHaveLength(1);
  });

  it('takes the list main sends after each change, such as one an agent added', async () => {
    let push: ((list: FollowUp[]) => void) | undefined;
    mockGroveBench.onFollowUpsChanged.mockImplementationOnce((cb: (list: FollowUp[]) => void) => {
      push = cb;
      return () => {};
    });
    // Subscribed once for the app's life: a fresh store module would listen again.
    vi.resetModules();
    const { followUpsStore: fresh } = await import('./followUps.svelte.js');
    await fresh.load(0);
    push?.([fu('new', '/r')]);
    expect(fresh.list.map((f) => f.id)).toEqual(['new']);
  });
});

describe('followUpsStore.byProject', () => {
  it('groups by project in the sidebar\'s order, open ones as they came, done ones most recent first', () => {
    followUpsStore.list = [
      fu('x', '/gone'),
      fu('b1', '/b'),
      fu('a1', '/a'),
      fu('a-old', '/a', { doneAt: 1 }),
      fu('a2', '/a'),
      fu('a-new', '/a', { doneAt: 5 }),
    ];
    const projects = followUpsStore.byProject(['/a', '/b']);
    expect(projects.map((p) => p.repoPath)).toEqual(['/a', '/b', '/gone']);
    expect(projects[0].open.map((f) => f.id)).toEqual(['a1', 'a2']);
    expect(projects[0].done.map((f) => f.id)).toEqual(['a-new', 'a-old']);
  });
});

describe('followUpsStore.toggleDrawer', () => {
  it('takes a new opening each time it opens, not when it stays open', () => {
    followUpsStore.toggleDrawer(true);
    const first = followUpsStore.opening;
    followUpsStore.toggleDrawer(true);
    expect(followUpsStore.opening).toBe(first);
    followUpsStore.toggleDrawer();
    expect(followUpsStore.drawerOpen).toBe(false);
    followUpsStore.toggleDrawer();
    expect(followUpsStore.opening).toBeGreaterThan(first);
  });
});

describe('followUpsStore.started', () => {
  it("logs a failure rather than throwing: it's only shown in the drawer", async () => {
    mockGroveBench.followUpStarted.mockRejectedValueOnce(new Error('locked'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(followUpsStore.started('a', 's1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
