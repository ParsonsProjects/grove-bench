import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/** An in-memory disk, for both the sync calls (loads, flushes) and the async
 *  ones (background saves). Renames move a temp file into place, as on disk. */
const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  /** What each write that reached the state file put there, in order. */
  const landed: string[] = [];
  const error = (code: string, p: string) => Object.assign(new Error(`${code}: ${p}`), { code });
  const read = (p: string) => {
    const text = files.get(p);
    if (text === undefined) throw error('ENOENT', p);
    return text;
  };
  const move = (from: string, to: string) => {
    const text = read(from);
    files.delete(from);
    files.set(to, text);
    if (to.endsWith('app-state.json')) landed.push(text);
  };
  const remove = (p: string) => {
    if (!files.delete(p)) throw error('ENOENT', p);
  };
  const sync = {
    readFileSync: vi.fn((p: string) => read(p)),
    writeFileSync: vi.fn((p: string, data: string) => { files.set(p, data); }),
    renameSync: vi.fn((from: string, to: string) => move(from, to)),
    unlinkSync: vi.fn((p: string) => remove(p)),
    copyFileSync: vi.fn(),
    rmSync: vi.fn((p: string) => { files.delete(p); }),
  };
  const promises = {
    readFile: vi.fn(async (p: string) => read(p)),
    writeFile: vi.fn(async (p: string, data: string) => { files.set(p, data); }),
    rename: vi.fn(async (from: string, to: string) => move(from, to)),
    rm: vi.fn(async (p: string) => { files.delete(p); }),
    copyFile: vi.fn(async () => {}),
  };
  return { files, landed, error, sync, promises };
});

vi.mock('node:fs', () => ({ default: { ...disk.sync, promises: disk.promises } }));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  loadAppState, saveOpenTabs, saveUnreadSessionIds, loadUnreadSessionIds, saveSessionSort,
  saveKnownSkills, loadKnownSkills, saveCollapsedPanels, flushPendingSaves, validateAppState, upgradeAppState, APP_STATE_SCHEMA_VERSION,
  loadPrerequisiteCache, loadModelCatalog, saveModelCatalog, loadUsageSnapshot, saveUsageSnapshot,
  loadSkillSuggestionCache, saveSkillSuggestionCache,
  mergeProjects, listProjects, rememberProject, forgetProject,
  loadConversationGroups, saveConversationGroups,
  loadTodoSessionIds, saveTodoSessionIds,
  appStateSaved, resetAppStateForTests,
} from './app-state.js';

const FILE = path.join('/mock/userData', 'app-state.json');
const V = APP_STATE_SCHEMA_VERSION;
const { sync, promises } = disk;

/** Put `initial` in the state file (none for undefined). */
function useDisk(initial: unknown) {
  disk.files.clear();
  if (initial !== undefined) disk.files.set(FILE, JSON.stringify(initial));
  return { get: () => (disk.files.has(FILE) ? JSON.parse(disk.files.get(FILE)!) : null) };
}

const lockError = () => disk.error('EBUSY', FILE);

/** Make the file unreadable, sync and async, until the returned function. */
function lockReads(): () => void {
  sync.readFileSync.mockImplementation(() => { throw lockError(); });
  promises.readFile.mockImplementation(async () => { throw lockError(); });
  return () => {
    sync.readFileSync.mockReset();
    promises.readFile.mockReset();
  };
}

/** Hold the next call of `mock` until the returned function is called. */
function holdNext(mock: Mock): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const impl = mock.getMockImplementation()!;
  mock.mockImplementationOnce(async (...args: unknown[]) => {
    await gate;
    return impl(...args);
  });
  return release;
}

/** Let the background save run as far as it can without timers. */
async function drain(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Files left beside the state file (temp files). */
const strays = () => [...disk.files.keys()].filter((p) => p !== FILE);

const syncWrites = () => sync.writeFileSync.mock.calls.length;
const asyncWrites = () => promises.writeFile.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(sync), ...Object.values(promises)]) fn.mockReset();
  disk.files.clear();
  disk.landed.length = 0;
  resetAppStateForTests();
  vi.useFakeTimers();
});

afterEach(async () => {
  await appStateSaved();
  vi.useRealTimers();
});

describe('loadAppState', () => {
  it('returns defaults when the file is missing', () => {
    useDisk(undefined);
    const s = loadAppState();
    expect(s.openTabIds).toEqual([]);
    expect(s.sessionSort).toEqual({ key: 'name', dir: 'asc' });
  });

  it('returns defaults on corrupt JSON', () => {
    disk.files.set(FILE, '{not json');
    expect(loadAppState().openTabIds).toEqual([]);
  });

  it('stamps an unversioned file on first load', async () => {
    const file = useDisk({ openTabIds: ['a', 'b'] });
    const s = loadAppState();
    expect(s.openTabIds).toEqual(['a', 'b']);
    await appStateSaved();
    expect(file.get().schemaVersion).toBe(V);
    expect(file.get().openTabIds).toEqual(['a', 'b']);
  });

  it('does not rewrite a current-version file', async () => {
    useDisk({ schemaVersion: V, openTabIds: ['a'] });
    loadAppState();
    await appStateSaved();
    expect(syncWrites() + asyncWrites()).toBe(0);
  });

  it('reads the file once, then keeps the state in memory', async () => {
    useDisk({ schemaVersion: V, openTabIds: ['a'] });
    loadAppState();
    saveKnownSkills('/r', ['x']);
    await appStateSaved();
    expect(loadKnownSkills('/r')).toEqual(['x']);
    expect(loadAppState().openTabIds).toEqual(['a']);
    expect(sync.readFileSync).toHaveBeenCalledTimes(1);
    expect(promises.readFile).not.toHaveBeenCalled();
  });

  it('reads again while the file can\'t be read, rather than keep defaults', () => {
    useDisk({ schemaVersion: V, openTabIds: ['a'] });
    const unlock = lockReads();
    expect(loadAppState().openTabIds).toEqual([]);
    unlock();
    expect(loadAppState().openTabIds).toEqual(['a']);
  });

  it('hands out copies, so changing one changes nothing saved', async () => {
    useDisk({ schemaVersion: V, openTabIds: ['a'], skillSuggestions: { '/r': { suggestions: [], dismissedIds: ['d'], analyzedAt: 1 } } });
    loadAppState().openTabIds.push('b');
    loadSkillSuggestionCache('/r')!.dismissedIds.push('e');
    expect(loadAppState().openTabIds).toEqual(['a']);
    expect(loadSkillSuggestionCache('/r')!.dismissedIds).toEqual(['d']);
  });

  it('sees a change before it is saved', () => {
    useDisk({ schemaVersion: V });
    saveOpenTabs(['x']);
    expect(loadAppState().openTabIds).toEqual(['x']);
    expect(asyncWrites()).toBe(0);
  });

  it('checks a changed field as a read of the file would', () => {
    useDisk({ schemaVersion: V });
    saveSessionSort({ key: 'size', dir: 'asc' } as never);
    expect(loadAppState().sessionSort).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('validateAppState', () => {
  it('resets only the corrupt fields', () => {
    const s = validateAppState({
      openTabIds: ['x', 3],
      collapsedRepos: { '/r': true },
      sessionSort: { key: 'size', dir: 'asc' },
      sidebarWidth: 'wide',
      unreadSessionIds: ['u1'],
    });
    expect(s.openTabIds).toEqual([]);
    expect(s.collapsedRepos).toEqual({ '/r': true });
    expect(s.sessionSort).toEqual({ key: 'name', dir: 'asc' });
    expect(s.sidebarWidth).toBeNull();
    expect(s.unreadSessionIds).toEqual(['u1']);
  });

  it('keeps known collapsed-panel flags and drops the rest', () => {
    const s = validateAppState({ collapsedPanels: { sidebar: true, changesFiles: 'yes', projectsSection: true, later: true } });
    expect(s.collapsedPanels).toEqual({ sidebar: true, projectsSection: true });
    expect(validateAppState({ collapsedPanels: 'all' }).collapsedPanels).toBeUndefined();
  });

  it('drops activeTabId, which older versions saved', () => {
    expect(validateAppState({ activeTabId: 'a', openTabIds: ['a'] })).not.toHaveProperty('activeTabId');
  });

  it('keeps caches with the expected shape and drops malformed ones', () => {
    const s = validateAppState({
      knownSkills: { '/r': ['a'] },
      skillSuggestions: { '/r': { suggestions: [], dismissedIds: [], analyzedAt: 1 } },
      prerequisiteCache: { status: {}, checkedAt: 'never' },
    });
    expect(s.knownSkills).toEqual({ '/r': ['a'] });
    expect(s.skillSuggestions?.['/r']?.analyzedAt).toBe(1);
    expect(s.prerequisiteCache).toBeNull();
  });

  it('warns but keeps known fields for a file newer than the app', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { state } = upgradeAppState({ schemaVersion: V + 1, openTabIds: ['z'], future: 1 });
    expect(state.openTabIds).toEqual(['z']);
    expect((state as any).future).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('saving', () => {
  it('coalesces rapid saves into one background write and keeps other fields', async () => {
    const file = useDisk({ schemaVersion: V, openTabIds: ['keep'] });
    saveUnreadSessionIds(['a']);
    saveUnreadSessionIds(['b']);
    expect(asyncWrites()).toBe(0);
    vi.advanceTimersByTime(500);
    await appStateSaved();
    expect(asyncWrites()).toBe(1);
    expect(syncWrites()).toBe(0);
    expect(sync.renameSync).not.toHaveBeenCalled();
    expect(file.get()).toEqual({ schemaVersion: V, openTabIds: ['keep'], collapsedRepos: {}, sessionSort: { key: 'name', dir: 'asc' }, sidebarWidth: null, unreadSessionIds: ['b'] });
    expect(strays()).toEqual([]);
  });

  it('saves the write-through fields straight away, merged into the file', async () => {
    const file = useDisk({ schemaVersion: V, knownSkills: { '/a': ['x'] } });
    saveKnownSkills('/b', ['y']);
    await appStateSaved();
    expect(file.get().knownSkills).toEqual({ '/a': ['x'], '/b': ['y'] });
  });

  it('round-trips unread session ids', async () => {
    useDisk(undefined);
    saveUnreadSessionIds(['s1', 's2']);
    vi.advanceTimersByTime(500);
    await appStateSaved();
    resetAppStateForTests(); // the next launch
    expect(loadUnreadSessionIds()).toEqual(['s1', 's2']);
  });

  it('saves collapsed panels, cleaned, and ignores junk from the renderer', () => {
    useDisk(undefined);
    saveCollapsedPanels({ sidebar: true, bogus: true });
    flushPendingSaves();
    expect(loadAppState().collapsedPanels).toEqual({ sidebar: true });

    sync.writeFileSync.mockClear();
    saveCollapsedPanels('everything');
    flushPendingSaves();
    expect(sync.writeFileSync).not.toHaveBeenCalled();
  });

  it('skips a save rather than write defaults over a file it can\'t read, and saves once it can', async () => {
    const saved = { schemaVersion: V, openTabIds: ['keep'], knownSkills: { '/a': ['x'] } };
    const file = useDisk(saved);
    const unlock = lockReads();

    saveKnownSkills('/b', ['y']);
    saveOpenTabs(['new']);
    flushPendingSaves();
    await vi.advanceTimersByTimeAsync(4_000); // the background read's lock retries
    expect(syncWrites() + asyncWrites()).toBe(0);
    expect(file.get()).toEqual(saved);

    unlock();
    await vi.advanceTimersByTimeAsync(5_000); // the next try
    await appStateSaved();
    expect(file.get()).toMatchObject({ openTabIds: ['new'], knownSkills: { '/a': ['x'], '/b': ['y'] } });
  });
});

describe('overlapping saves', () => {
  it('runs one write at a time; changes made during one go out in the next, the latest winning', async () => {
    const file = useDisk({ schemaVersion: V, openTabIds: ['keep'] });
    const release = holdNext(promises.writeFile);
    saveKnownSkills('/a', ['1']);
    await drain();
    expect(asyncWrites()).toBe(1);

    saveKnownSkills('/a', ['2']);
    saveKnownSkills('/b', ['3']);
    saveOpenTabs(['t']);
    vi.advanceTimersByTime(500);
    await drain();
    expect(asyncWrites()).toBe(1); // no second write while the first is out

    release();
    await appStateSaved();
    expect(asyncWrites()).toBe(2);
    expect(disk.landed.map((text) => JSON.parse(text).knownSkills)).toEqual([
      { '/a': ['1'] },
      { '/a': ['2'], '/b': ['3'] },
    ]);
    expect(file.get()).toMatchObject({ openTabIds: ['t'], knownSkills: { '/a': ['2'], '/b': ['3'] } });
    expect(strays()).toEqual([]);
  });

  it('a flush cancels a background write whose rename is on its way, so it can\'t land after', async () => {
    const file = useDisk({ schemaVersion: V });
    loadAppState();
    const release = holdNext(promises.rename);
    saveOpenTabs(['old']);
    vi.advanceTimersByTime(500);
    await drain();
    expect(promises.rename).toHaveBeenCalledTimes(1);

    saveOpenTabs(['new']);
    flushPendingSaves();
    expect(file.get().openTabIds).toEqual(['new']);

    release();
    await appStateSaved();
    expect(file.get().openTabIds).toEqual(['new']);
    expect(disk.landed.map((text) => JSON.parse(text).openTabIds)).toEqual([['new']]);
    expect(strays()).toEqual([]);
  });

  it('a flush cancels a background write still writing its temp file', async () => {
    const file = useDisk({ schemaVersion: V });
    loadAppState();
    const release = holdNext(promises.writeFile);
    saveOpenTabs(['old']);
    vi.advanceTimersByTime(500);
    await drain();

    saveOpenTabs(['new']);
    flushPendingSaves();
    release();
    await appStateSaved();
    expect(file.get().openTabIds).toEqual(['new']);
    expect(promises.rename).not.toHaveBeenCalled();
    expect(strays()).toEqual([]);
  });

  it('writes again when a flush couldn\'t stop a background write that then landed', async () => {
    const file = useDisk({ schemaVersion: V });
    loadAppState();
    const release = holdNext(promises.rename);
    saveOpenTabs(['old']);
    vi.advanceTimersByTime(500);
    await drain();

    // The temp file stays locked, so the flush can't delete it.
    sync.unlinkSync.mockImplementation(() => { throw lockError(); });
    saveOpenTabs(['new']);
    flushPendingSaves();
    expect(file.get().openTabIds).toEqual(['new']);

    release();
    await appStateSaved();
    expect(disk.landed.map((text) => JSON.parse(text).openTabIds)).toEqual([['new'], ['old'], ['new']]);
    expect(file.get().openTabIds).toEqual(['new']);
  });

  it('a flush with nothing new does nothing', async () => {
    useDisk({ schemaVersion: V });
    saveOpenTabs(['a']);
    vi.advanceTimersByTime(500);
    await appStateSaved();
    flushPendingSaves();
    expect(syncWrites()).toBe(0);
    expect(disk.landed).toHaveLength(1);
  });
});

describe('a write that fails', () => {
  it('leaves the file as it was and keeps the change for the next try', async () => {
    const file = useDisk({ schemaVersion: V, openTabIds: ['keep'] });
    // Out of disk space halfway through the temp file.
    promises.writeFile.mockImplementationOnce(async (p: string, data: string) => {
      disk.files.set(p, data.slice(0, 10));
      throw disk.error('ENOSPC', p);
    });
    saveKnownSkills('/a', ['x']);
    await appStateSaved();
    expect(file.get()).toEqual({ schemaVersion: V, openTabIds: ['keep'] });
    expect(strays()).toEqual([]);
    expect(loadKnownSkills('/a')).toEqual(['x']);

    await vi.advanceTimersByTimeAsync(5_000);
    await appStateSaved();
    expect(file.get()).toMatchObject({ openTabIds: ['keep'], knownSkills: { '/a': ['x'] } });
  });

  it('cleans up after a failed rename, and a flush then saves the change', async () => {
    const file = useDisk({ schemaVersion: V });
    promises.rename.mockImplementationOnce(async () => { throw disk.error('EXDEV', FILE); });
    saveKnownSkills('/a', ['x']);
    await appStateSaved();
    expect(file.get().knownSkills).toBeUndefined();
    expect(strays()).toEqual([]);

    flushPendingSaves();
    expect(file.get().knownSkills).toEqual({ '/a': ['x'] });
  });

  it('rides out a locked rename with timers, not by blocking', async () => {
    const file = useDisk({ schemaVersion: V });
    promises.rename.mockImplementationOnce(async () => { throw lockError(); });
    saveKnownSkills('/a', ['x']);
    await drain();
    expect(file.get().knownSkills).toBeUndefined();
    await vi.advanceTimersByTimeAsync(50);
    await appStateSaved();
    expect(file.get().knownSkills).toEqual({ '/a': ['x'] });
    expect(sync.renameSync).not.toHaveBeenCalled();
  });
});

describe('loadPrerequisiteCache', () => {
  it('returns a per-agent cache', () => {
    const status = { git: { available: true }, agents: { 'claude-code': { available: true, authenticated: true } } };
    useDisk({ schemaVersion: V, prerequisiteCache: { status, checkedAt: 1 } });
    expect(loadPrerequisiteCache()?.status).toEqual(status);
  });

  it('drops a cache written before per-agent status', () => {
    useDisk({
      schemaVersion: V,
      prerequisiteCache: { status: { git: { available: true }, agent: { available: true, authenticated: true } }, checkedAt: 1 },
    });
    expect(loadPrerequisiteCache()).toBeNull();
  });
});

describe('model catalogs', () => {
  it('saves and reads back each agent\'s model list', () => {
    useDisk({ schemaVersion: V });
    saveModelCatalog('claude-code', [{ id: 'claude-opus-5-5' }]);
    saveModelCatalog('codex', [{ id: 'codex-a' }]);
    expect(loadModelCatalog('claude-code')).toEqual([{ id: 'claude-opus-5-5' }]);
    expect(loadModelCatalog('codex')).toEqual([{ id: 'codex-a' }]);
    expect(loadModelCatalog('missing')).toBeNull();
  });
});

describe('usage snapshots', () => {
  it('keeps each agent\'s last plan usage, written once the burst settles', async () => {
    const file = useDisk({ schemaVersion: V, usageSnapshots: { other: { available: false, windows: [], fetchedAt: 1 } } });
    const usage = { available: true, plan: 'max', windows: [{ id: 'five_hour', label: '5-hour', utilization: 0.4 }], fetchedAt: 2 };

    saveUsageSnapshot('claude-code', usage);
    saveUsageSnapshot('claude-code', { ...usage, updatedAt: 3 });
    expect(loadUsageSnapshot('claude-code')?.updatedAt).toBe(3);
    expect(asyncWrites()).toBe(0);

    vi.advanceTimersByTime(600);
    await appStateSaved();
    expect(file.get().usageSnapshots['claude-code'].updatedAt).toBe(3);
    expect(file.get().usageSnapshots.other.fetchedAt).toBe(1);
    expect(loadUsageSnapshot('missing')).toBeNull();
  });

  it('drops a malformed usage map instead of failing the whole file', () => {
    expect(validateAppState({ usageSnapshots: { a: { windows: 'nope' } } }).usageSnapshots).toBeUndefined();
  });
});

describe('projects', () => {
  it('keeps a project with no conversations across a restart', async () => {
    const file = useDisk({ projects: [] });
    rememberProject('C:\\notes');
    await appStateSaved();
    resetAppStateForTests();
    // At the next launch the manifest knows nothing about it.
    expect(listProjects([])).toEqual(['C:\\notes']);
    expect(file.get().projects).toEqual(['C:\\notes']);
  });

  it('adds projects the manifest knows once, after the remembered ones, in order', () => {
    expect(mergeProjects(['/b'], ['/a', '/b', '/c'])).toEqual(['/b', '/a', '/c']);
    expect(mergeProjects(undefined, ['/a', '/b'])).toEqual(['/a', '/b']);
  });

  it('starts the list from the manifest the first time, keeping its order', async () => {
    const file = useDisk({});
    expect(listProjects(['/a', '/b'])).toEqual(['/a', '/b']);
    await appStateSaved();
    expect(file.get().projects).toEqual(['/a', '/b']);
    rememberProject('/c');
    rememberProject('/a');
    await appStateSaved();
    expect(file.get().projects).toEqual(['/a', '/b', '/c']);
  });

  it('merges a list made while the file was locked with the file\'s, once it can be read', async () => {
    const file = useDisk({ schemaVersion: V, projects: ['/kept'] });
    const unlock = lockReads();
    expect(listProjects(['/m'])).toEqual(['/m']);
    await vi.advanceTimersByTimeAsync(4_000);
    unlock();
    await vi.advanceTimersByTimeAsync(5_000);
    await appStateSaved();
    expect(file.get().projects).toEqual(['/kept', '/m']);
  });

  it('forgets a removed project', async () => {
    const file = useDisk({ projects: ['/a', '/b'] });
    forgetProject('/a');
    await appStateSaved();
    expect(file.get().projects).toEqual(['/b']);
    expect(listProjects([])).toEqual(['/b']);
  });

  it('drops a malformed project list', () => {
    expect(validateAppState({ projects: 'nope' }).projects).toBeUndefined();
  });
});


describe('conversation groups', () => {
  const billing = { id: 'g1', name: 'Billing', sessionIds: ['a', 'b'] };

  it('reads back the latest before it is saved, then saves it with the rest', async () => {
    const file = useDisk({ schemaVersion: V, openTabIds: ['keep'] });
    saveConversationGroups([{ ...billing, name: 'old' }]);
    saveConversationGroups([billing]);
    expect(loadConversationGroups()).toEqual([billing]);
    expect(syncWrites() + asyncWrites()).toBe(0);
    vi.advanceTimersByTime(500);
    await appStateSaved();
    expect(asyncWrites()).toBe(1);
    expect(file.get()).toMatchObject({ groups: [billing], openTabIds: ['keep'] });
  });

  it('has none until the first is saved', () => {
    useDisk(undefined);
    expect(loadConversationGroups()).toEqual([]);
  });

  it('says it can\'t tell while the file can\'t be read, rather than "none"', () => {
    useDisk({ schemaVersion: V, groups: [billing] });
    lockReads();
    expect(loadConversationGroups()).toBeNull();
  });

  it('drops a malformed group and keeps the rest', () => {
    const state = validateAppState({ groups: [billing, { id: '', name: 'x', sessionIds: ['c'] }, { name: 'no id' }, 'junk'] });
    expect(state.groups).toEqual([billing]);
    expect(validateAppState({ groups: 'nope' }).groups).toBeUndefined();
  });

  it('lists a conversation once, in its first group, and drops a group left with none', () => {
    const state = validateAppState({ groups: [
      { id: 'g1', name: 'A', sessionIds: ['a', 'a', 'b'] },
      { id: 'g2', name: 'B', sessionIds: ['b', 'c'] },
      { id: 'g3', name: 'C', sessionIds: ['a'] },
      { id: 'g4', name: 'D', sessionIds: [] },
    ] });
    expect(state.groups).toEqual([
      { id: 'g1', name: 'A', sessionIds: ['a', 'b'] },
      { id: 'g2', name: 'B', sessionIds: ['c'] },
    ]);
  });

  it('ignores junk from the renderer instead of saving it', () => {
    useDisk({ schemaVersion: V, groups: [billing] });
    saveConversationGroups('everything');
    flushPendingSaves();
    expect(syncWrites() + asyncWrites()).toBe(0);
    expect(loadConversationGroups()).toEqual([billing]);
  });
});

describe('To do flags', () => {
  it('reads back the latest before it is saved, then saves it with the rest', async () => {
    const file = useDisk({ schemaVersion: V, openTabIds: ['keep'] });
    saveTodoSessionIds(['a']);
    saveTodoSessionIds(['a', 'b']);
    expect(loadTodoSessionIds()).toEqual(['a', 'b']);
    expect(syncWrites() + asyncWrites()).toBe(0);
    vi.advanceTimersByTime(500);
    await appStateSaved();
    expect(file.get()).toMatchObject({ todoSessionIds: ['a', 'b'], openTabIds: ['keep'] });
  });

  it('has none until the first is saved', () => {
    useDisk(undefined);
    expect(loadTodoSessionIds()).toEqual([]);
  });

  it('says it can\'t tell while the file can\'t be read, rather than "none"', () => {
    useDisk({ schemaVersion: V, todoSessionIds: ['a'] });
    lockReads();
    expect(loadTodoSessionIds()).toBeNull();
  });

  it('ignores junk from the renderer and in the file', () => {
    useDisk({ schemaVersion: V, todoSessionIds: ['a'] });
    saveTodoSessionIds([1, 2]);
    saveTodoSessionIds('a');
    flushPendingSaves();
    expect(syncWrites() + asyncWrites()).toBe(0);
    expect(loadTodoSessionIds()).toEqual(['a']);
    expect(validateAppState({ todoSessionIds: 'nope' }).todoSessionIds).toBeUndefined();
  });
});
