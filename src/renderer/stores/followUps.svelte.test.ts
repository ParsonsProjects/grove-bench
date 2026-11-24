import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { followUpsStore } from './followUps.svelte.js';
import type { FollowUp, FollowUpsChange } from '../../shared/follow-ups.js';

function fu(id: string, repoPath: string, extra: Partial<FollowUp> = {}): FollowUp {
  return { id, repoPath, title: id, details: '', createdAt: 0, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  followUpsStore.list = [];
  followUpsStore.ready = false;
  followUpsStore.loadFailed = false;
  followUpsStore.drawerOpen = false;
});

describe('followUpsStore.load', () => {
  it('loads the list and counts the open ones', async () => {
    mockGroveBench.listFollowUps.mockResolvedValueOnce([fu('a', '/r'), fu('b', '/r', { doneAt: 1 })]);
    await followUpsStore.load(0);
    expect(followUpsStore.ready).toBe(true);
    expect(followUpsStore.list.map((f) => f.id)).toEqual(['a', 'b']);
    expect(followUpsStore.openCountIn(['/r'])).toBe(1);
  });

  it("asks again while the file can't be read", async () => {
    mockGroveBench.listFollowUps.mockResolvedValueOnce(null).mockResolvedValueOnce([fu('a', '/r')]);
    await followUpsStore.load(0);
    expect(mockGroveBench.listFollowUps).toHaveBeenCalledTimes(2);
    expect(followUpsStore.list).toHaveLength(1);
  });

  /** A fresh store (it subscribes once for the app's life) and the way to
   *  send it a change as main would. */
  async function freshStore() {
    let push: ((change: FollowUpsChange) => void) | undefined;
    mockGroveBench.onFollowUpsChanged.mockImplementationOnce((cb: (change: FollowUpsChange) => void) => {
      push = cb;
      return () => {};
    });
    vi.resetModules();
    const { followUpsStore: fresh } = await import('./followUps.svelte.js');
    return { fresh, push: (change: FollowUpsChange) => push?.(change) };
  }

  it('applies what main says changed, such as one an agent added', async () => {
    mockGroveBench.listFollowUps.mockResolvedValueOnce([fu('a', '/r'), fu('b', '/r')]);
    const { fresh, push } = await freshStore();
    await fresh.load(0);
    push({ upserted: [fu('a', '/r', { doneAt: 3 }), fu('new', '/r')], removed: ['b'] });
    expect(fresh.list.map((f) => [f.id, f.doneAt])).toEqual([['a', 3], ['new', undefined]]);
  });

  it('keeps a change that arrives before the list, and applies it once the list is read', async () => {
    let answer: (list: FollowUp[]) => void = () => {};
    mockGroveBench.listFollowUps.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { fresh, push } = await freshStore();
    const loading = fresh.load(0);
    push({ upserted: [fu('new', '/r')], removed: ['a'] });
    answer([fu('a', '/r')]);
    await loading;
    expect(fresh.list.map((f) => f.id)).toEqual(['new']);
  });

  it('says it failed when the file stays unreadable, and reads it again after the next change', async () => {
    mockGroveBench.listFollowUps.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fresh, push } = await freshStore();
    await fresh.load(0);
    expect(fresh.loadFailed).toBe(true);
    expect(fresh.ready).toBe(false);
    mockGroveBench.listFollowUps.mockResolvedValue([fu('a', '/r')]);
    push({ upserted: [fu('b', '/r')], removed: [] });
    await vi.waitFor(() => expect(fresh.ready).toBe(true));
    expect(fresh.loadFailed).toBe(false);
    expect(fresh.list.map((f) => f.id)).toEqual(['a', 'b']);
    mockGroveBench.listFollowUps.mockImplementation(() => Promise.resolve([]));
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

  it('puts open ones highest priority first, as they came inside each', () => {
    followUpsStore.list = [fu('low', '/a', { priority: 'low' }), fu('n1', '/a'), fu('high', '/a', { priority: 'high' }), fu('n2', '/a', { priority: 'normal' })];
    expect(followUpsStore.byProject(['/a'])[0].open.map((f) => f.id)).toEqual(['high', 'n1', 'n2', 'low']);
  });
});

describe('followUpsStore.setPriority', () => {
  it('asks main to change it', async () => {
    await followUpsStore.setPriority('a1', 'high');
    expect(mockGroveBench.setFollowUpPriority).toHaveBeenCalledWith('a1', 'high');
  });
});

describe('followUpsStore.openCountIn', () => {
  it("counts open ones in the given projects only: a removed project's can't be started", () => {
    followUpsStore.list = [fu('a', '/r'), fu('b', '/removed'), fu('c', '/r', { doneAt: 1 })];
    expect(followUpsStore.openCountIn(['/r'])).toBe(1);
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

  it('drops its notice when it closes', () => {
    followUpsStore.toggleDrawer(true);
    followUpsStore.notice = { tone: 'warning', text: 'x' };
    followUpsStore.toggleDrawer(false);
    expect(followUpsStore.notice).toBeNull();
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

describe('followUpsStore.add', () => {
  it('asks main to add it and shows it at once', async () => {
    followUpsStore.ready = true;
    followUpsStore.list = [fu('a', '/r')];
    mockGroveBench.addFollowUp.mockResolvedValueOnce({ followUp: fu('new', '/r', { title: 'Write the docs' }), existing: false });
    const result = await followUpsStore.add('/r', 'Write the docs', 'In docs/help.', 'low');
    expect(mockGroveBench.addFollowUp).toHaveBeenCalledWith('/r', 'Write the docs', 'In docs/help.', 'low');
    expect(result.existing).toBe(false);
    expect(followUpsStore.list.map((f) => f.id)).toEqual(['a', 'new']);
    // Main's own change for it, arriving after, changes nothing.
    expect(followUpsStore.openIn('/r')).toBe(2);
  });

  it("adds nothing when main kept an open one with that title", async () => {
    followUpsStore.ready = true;
    followUpsStore.list = [fu('a', '/r')];
    mockGroveBench.addFollowUp.mockResolvedValueOnce({ followUp: fu('a', '/r'), existing: true });
    const result = await followUpsStore.add('/r', 'a', '');
    expect(result.existing).toBe(true);
    expect(followUpsStore.list).toHaveLength(1);
  });
});

describe('followUpsStore.openIn', () => {
  it("counts a project's open follow-ups only", () => {
    followUpsStore.list = [fu('a', '/r'), fu('b', '/r', { doneAt: 1 }), fu('c', '/other')];
    expect(followUpsStore.openIn('/r')).toBe(1);
  });
});

describe('followUpsStore New follow-up dialog', () => {
  it('opens for a project and closes', () => {
    followUpsStore.openAdd('/r');
    expect(followUpsStore.addingIn).toEqual({ repoPath: '/r' });
    followUpsStore.closeAdd();
    expect(followUpsStore.addingIn).toBeNull();
    followUpsStore.openAdd();
    expect(followUpsStore.addingIn).toEqual({ repoPath: '' });
    followUpsStore.closeAdd();
  });
});

describe('followUpsStore.startedFrom and reveal', () => {
  it('finds the follow-up a thread was started from', () => {
    followUpsStore.list = [fu('a', '/r'), fu('b', '/r', { startedSessionIds: ['s1', 's2'] })];
    expect(followUpsStore.startedFrom('s2')?.id).toBe('b');
    expect(followUpsStore.startedFrom('s3')).toBeUndefined();
  });

  it('opens the drawer at a follow-up, in full, and forgets it when the drawer closes', () => {
    followUpsStore.list = [fu('a', '/r')];
    followUpsStore.expanded = new Set();
    followUpsStore.reveal('a');
    expect(followUpsStore.drawerOpen).toBe(true);
    expect(followUpsStore.revealId).toBe('a');
    expect(followUpsStore.expanded.has('a')).toBe(true);
    followUpsStore.toggleDrawer(false);
    expect(followUpsStore.revealId).toBeNull();
  });

  it("shows its project's done ones when it is done", () => {
    followUpsStore.list = [fu('a', '/r', { doneAt: 5 })];
    followUpsStore.showDone = new Set();
    followUpsStore.reveal('a');
    expect(followUpsStore.showDone.has('/r')).toBe(true);
    followUpsStore.toggleDrawer(false);
  });

  it('counts each reveal, the same follow-up again included', () => {
    followUpsStore.list = [fu('a', '/r')];
    const before = followUpsStore.revealCount;
    followUpsStore.reveal('a');
    followUpsStore.reveal('a');
    expect(followUpsStore.revealCount).toBe(before + 2);
    followUpsStore.toggleDrawer(false);
  });

  it('does nothing for one that is gone', () => {
    followUpsStore.list = [];
    followUpsStore.reveal('zz');
    expect(followUpsStore.drawerOpen).toBe(false);
  });
});
