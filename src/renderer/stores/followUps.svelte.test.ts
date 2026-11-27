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
  followUpsStore.collapsed = new Set();
  followUpsStore.unfolded = new Set();
  followUpsStore.showEnded = new Set();
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
  it('groups by project in the sidebar\'s order, open ones as they came, done and closed ones most recent first', () => {
    followUpsStore.list = [
      fu('x', '/gone'),
      fu('b1', '/b'),
      fu('a1', '/a'),
      fu('a-old', '/a', { doneAt: 1 }),
      fu('a2', '/a'),
      fu('a-closed', '/a', { closedAt: 3 }),
      fu('a-new', '/a', { doneAt: 5 }),
    ];
    const projects = followUpsStore.byProject(['/a', '/b']);
    expect(projects.map((p) => p.repoPath)).toEqual(['/a', '/b', '/gone']);
    expect(projects[0].open.map((f) => f.id)).toEqual(['a1', 'a2']);
    expect(projects[0].ended.map((f) => f.id)).toEqual(['a-new', 'a-closed', 'a-old']);
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
    followUpsStore.list = [fu('a', '/r'), fu('b', '/removed'), fu('c', '/r', { doneAt: 1 }), fu('d', '/r', { closedAt: 1 })];
    expect(followUpsStore.openCountIn(['/r'])).toBe(1);
  });
});

describe('followUpsStore folded projects', () => {
  it('folds and opens a project, saving the list each time', () => {
    followUpsStore.toggleCollapsed('/a');
    expect(followUpsStore.isCollapsed('/a')).toBe(true);
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/a']);
    followUpsStore.toggleCollapsed('/b', true);
    followUpsStore.toggleCollapsed('/a');
    expect(followUpsStore.isCollapsed('/a')).toBe(false);
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/b']);
  });

  it("saves nothing when it is already the way it's asked to be", () => {
    followUpsStore.toggleCollapsed('/a', false);
    expect(mockGroveBench.setCollapsedFollowUpProjects).not.toHaveBeenCalled();
  });

  /** A fresh store whose saved folds arrive when `answer` is called. */
  async function loadingFolds() {
    let answer: (list: string[]) => void = () => {};
    mockGroveBench.getCollapsedFollowUpProjects.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    vi.resetModules();
    const { followUpsStore: fresh } = await import('./followUps.svelte.js');
    const loading = fresh.loadCollapsed();
    return { fresh, loading, answer: (list: string[]) => answer(list) };
  }

  it('reads the saved ones once, keeping a fold made while they load, and saves both together', async () => {
    const { fresh, loading, answer } = await loadingFolds();
    fresh.toggleCollapsed('/new');
    // Not saved yet: that would replace the saved list with this fold alone.
    expect(mockGroveBench.setCollapsedFollowUpProjects).not.toHaveBeenCalled();
    answer(['/saved']);
    await loading;
    await fresh.loadCollapsed();
    expect([...fresh.collapsed].sort()).toEqual(['/new', '/saved']);
    expect(mockGroveBench.getCollapsedFollowUpProjects).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenCalledTimes(1);
    expect([...mockGroveBench.setCollapsedFollowUpProjects.mock.calls[0][0]].sort()).toEqual(['/new', '/saved']);
  });

  it("doesn't fold again a saved project opened while they load", async () => {
    const { fresh, loading, answer } = await loadingFolds();
    // Folded in memory only, so it can be opened before the answer comes.
    fresh.collapsed = new Set(['/saved']);
    fresh.toggleCollapsed('/saved', false);
    answer(['/saved', '/other']);
    await loading;
    expect([...fresh.collapsed]).toEqual(['/other']);
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/other']);
  });

  it("saves nothing back when nothing was folded while they loaded", async () => {
    const { loading, answer } = await loadingFolds();
    answer(['/saved']);
    await loading;
    expect(mockGroveBench.setCollapsedFollowUpProjects).not.toHaveBeenCalled();
  });

  it('forgets folds of projects with no follow-ups left, once both lists are read', async () => {
    mockGroveBench.getCollapsedFollowUpProjects.mockResolvedValueOnce(['/kept', '/gone']);
    mockGroveBench.listFollowUps.mockResolvedValueOnce([fu('a', '/kept')]);
    vi.resetModules();
    const { followUpsStore: fresh } = await import('./followUps.svelte.js');
    await fresh.load(0);
    await fresh.loadCollapsed();
    expect([...fresh.collapsed]).toEqual(['/kept']);
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/kept']);
  });

  it('saves only folds of projects that have follow-ups', () => {
    followUpsStore.ready = true;
    followUpsStore.list = [fu('a', '/a')];
    followUpsStore.collapsed = new Set(['/stale']);
    followUpsStore.toggleCollapsed('/a');
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/a']);
  });
});

describe('followUpsStore.close', () => {
  it('asks main to close it', async () => {
    await followUpsStore.close('a1');
    expect(mockGroveBench.closeFollowUp).toHaveBeenCalledWith('a1');
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
    followUpsStore.list = [fu('a', '/r'), fu('b', '/r', { doneAt: 1 }), fu('c', '/other'), fu('d', '/r', { closedAt: 1 })];
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

  it("shows its project's done and closed ones when it is one of them", () => {
    followUpsStore.list = [fu('a', '/r', { doneAt: 5 }), fu('b', '/s', { closedAt: 5 })];
    followUpsStore.reveal('a');
    followUpsStore.reveal('b');
    expect([...followUpsStore.showEnded]).toEqual(['/r', '/s']);
    followUpsStore.toggleDrawer(false);
  });

  it('opens its project if it was folded, and shows it as a whole card until the drawer closes', () => {
    followUpsStore.list = [fu('a', '/r', { startedSessionIds: ['s1'] })];
    followUpsStore.toggleCollapsed('/r', true);
    followUpsStore.reveal('a');
    expect(followUpsStore.isCollapsed('/r')).toBe(false);
    expect(followUpsStore.unfolded.has('a')).toBe(true);
    followUpsStore.toggleDrawer(false);
    expect(followUpsStore.unfolded.has('a')).toBe(false);
  });

  it('folds the last one it showed in full when it shows another', () => {
    followUpsStore.list = [fu('a', '/r'), fu('b', '/r')];
    followUpsStore.reveal('a');
    followUpsStore.reveal('b');
    expect([...followUpsStore.unfolded]).toEqual(['b']);
    followUpsStore.toggleDrawer(false);
  });

  it('leaves one you had shown in full as it is', () => {
    followUpsStore.list = [fu('a', '/r'), fu('b', '/r')];
    followUpsStore.toggleUnfolded('a');
    followUpsStore.reveal('a');
    followUpsStore.reveal('b');
    // You show this one in full after the reveal did: yours now.
    followUpsStore.toggleUnfolded('b');
    followUpsStore.toggleUnfolded('b');
    followUpsStore.toggleDrawer(false);
    expect([...followUpsStore.unfolded].sort()).toEqual(['a', 'b']);
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
