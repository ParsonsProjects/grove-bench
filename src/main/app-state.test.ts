import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockReadFileSync, mockWriteFileSync, mockRenameSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRenameSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  loadAppState, saveOpenTabs, saveUnreadSessionIds, loadUnreadSessionIds,
  saveKnownSkills, saveCollapsedPanels, flushPendingSaves, validateAppState, upgradeAppState, APP_STATE_SCHEMA_VERSION,
  loadPrerequisiteCache, loadModelCatalog, saveModelCatalog,
  mergeProjects, listProjects, rememberProject, forgetProject,
  loadConversationGroups, saveConversationGroups,
} from './app-state.js';

/** The file as the last write left it, so read-modify-write chains see their own updates. */
function useDisk(initial: unknown) {
  let disk = initial === undefined ? null : JSON.stringify(initial);
  const temp = new Map<string, string>();
  mockReadFileSync.mockImplementation(() => {
    if (disk === null) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    return disk;
  });
  // Writes land in a temp file; the rename puts them in place.
  mockWriteFileSync.mockImplementation((p: string, data: string) => { temp.set(p, data); });
  mockRenameSync.mockImplementation((from: string) => { disk = temp.get(from) ?? null; temp.delete(from); });
  return { get: () => (disk === null ? null : JSON.parse(disk)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  flushPendingSaves();
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
    mockReadFileSync.mockReturnValue('{not json');
    expect(loadAppState().openTabIds).toEqual([]);
  });

  it('stamps an unversioned file on first load', () => {
    const disk = useDisk({ openTabIds: ['a', 'b'] });
    const s = loadAppState();
    expect(s.openTabIds).toEqual(['a', 'b']);
    expect(disk.get().schemaVersion).toBe(APP_STATE_SCHEMA_VERSION);
  });

  it('does not rewrite a current-version file', () => {
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, openTabIds: ['a'] });
    loadAppState();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
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
    const s = validateAppState({ collapsedPanels: { sidebar: true, changesFiles: 'yes', later: true } });
    expect(s.collapsedPanels).toEqual({ sidebar: true });
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
    const { state } = upgradeAppState({ schemaVersion: APP_STATE_SCHEMA_VERSION + 1, openTabIds: ['z'], future: 1 });
    expect(state.openTabIds).toEqual(['z']);
    expect((state as any).future).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('debounced writers', () => {
  it('coalesces rapid saves into one write and keeps other fields', () => {
    const disk = useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, openTabIds: ['keep'] });
    saveUnreadSessionIds(['a']);
    saveUnreadSessionIds(['b']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(disk.get()).toMatchObject({ schemaVersion: APP_STATE_SCHEMA_VERSION, unreadSessionIds: ['b'], openTabIds: ['keep'] });
  });

  it('flushPendingSaves writes every pending field immediately', () => {
    const disk = useDisk(undefined);
    saveOpenTabs(['a']);
    saveUnreadSessionIds(['u']);
    flushPendingSaves();
    expect(disk.get()).toMatchObject({ openTabIds: ['a'], unreadSessionIds: ['u'] });
    // Nothing left to write
    mockWriteFileSync.mockClear();
    vi.advanceTimersByTime(1000);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('round-trips unread session ids', () => {
    useDisk(undefined);
    saveUnreadSessionIds(['s1', 's2']);
    flushPendingSaves();
    expect(loadUnreadSessionIds()).toEqual(['s1', 's2']);
  });

  it('saves collapsed panels, cleaned, and ignores junk from the renderer', () => {
    useDisk(undefined);
    saveCollapsedPanels({ sidebar: true, bogus: true });
    flushPendingSaves();
    expect(loadAppState().collapsedPanels).toEqual({ sidebar: true });

    mockWriteFileSync.mockClear();
    saveCollapsedPanels('everything');
    flushPendingSaves();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('write-through helpers merge into the existing file', () => {
    const disk = useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, knownSkills: { '/a': ['x'] } });
    saveKnownSkills('/b', ['y']);
    expect(disk.get().knownSkills).toEqual({ '/a': ['x'], '/b': ['y'] });
  });

  it('skips a save rather than write defaults over a file it can\'t read', () => {
    const saved = { schemaVersion: APP_STATE_SCHEMA_VERSION, openTabIds: ['keep'], knownSkills: { '/a': ['x'] } };
    const disk = useDisk(saved);
    mockReadFileSync.mockImplementation(() => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); });

    saveKnownSkills('/b', ['y']);
    saveOpenTabs(['new']);
    flushPendingSaves();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(disk.get()).toEqual(saved);
  });
});

describe('loadPrerequisiteCache', () => {
  it('returns a per-agent cache', () => {
    const status = { git: { available: true }, agents: { 'claude-code': { available: true, authenticated: true } } };
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, prerequisiteCache: { status, checkedAt: 1 } });
    expect(loadPrerequisiteCache()?.status).toEqual(status);
  });

  it('drops a cache written before per-agent status', () => {
    useDisk({
      schemaVersion: APP_STATE_SCHEMA_VERSION,
      prerequisiteCache: { status: { git: { available: true }, agent: { available: true, authenticated: true } }, checkedAt: 1 },
    });
    expect(loadPrerequisiteCache()).toBeNull();
  });
});

describe('model catalogs', () => {
  it('saves and reads back each agent\'s model list', () => {
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION });
    saveModelCatalog('claude-code', [{ id: 'claude-opus-5-5' }]);
    saveModelCatalog('codex', [{ id: 'codex-a' }]);
    expect(loadModelCatalog('claude-code')).toEqual([{ id: 'claude-opus-5-5' }]);
    expect(loadModelCatalog('codex')).toEqual([{ id: 'codex-a' }]);
    expect(loadModelCatalog('missing')).toBeNull();
  });
});

describe('projects', () => {
  it('keeps a project with no conversations across a restart', () => {
    const disk = useDisk({ projects: [] });
    rememberProject('C:\\notes');
    // At the next launch the manifest knows nothing about it.
    expect(listProjects([])).toEqual(['C:\\notes']);
    expect(disk.get().projects).toEqual(['C:\\notes']);
  });

  it('adds projects the manifest knows once, after the remembered ones, in order', () => {
    expect(mergeProjects(['/b'], ['/a', '/b', '/c'])).toEqual(['/b', '/a', '/c']);
    expect(mergeProjects(undefined, ['/a', '/b'])).toEqual(['/a', '/b']);
  });

  it('starts the list from the manifest the first time, keeping its order', () => {
    const disk = useDisk({});
    expect(listProjects(['/a', '/b'])).toEqual(['/a', '/b']);
    expect(disk.get().projects).toEqual(['/a', '/b']);
    rememberProject('/c');
    rememberProject('/a');
    expect(disk.get().projects).toEqual(['/a', '/b', '/c']);
  });

  it('forgets a removed project', () => {
    const disk = useDisk({ projects: ['/a', '/b'] });
    forgetProject('/a');
    expect(disk.get().projects).toEqual(['/b']);
    expect(listProjects([])).toEqual(['/b']);
  });

  it('drops a malformed project list', () => {
    expect(validateAppState({ projects: 'nope' }).projects).toBeUndefined();
  });
});


describe('conversation groups', () => {
  const billing = { id: 'g1', name: 'Billing', sessionIds: ['a', 'b'] };

  it('saves debounced and reads back, flushing first', () => {
    const disk = useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, openTabIds: ['keep'] });
    saveConversationGroups([{ ...billing, name: 'old' }]);
    saveConversationGroups([billing]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    // A read writes what is pending first, so it never returns stale groups.
    expect(loadConversationGroups()).toEqual([billing]);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(disk.get()).toMatchObject({ groups: [billing], openTabIds: ['keep'] });
  });

  it('has none until the first is saved', () => {
    useDisk(undefined);
    expect(loadConversationGroups()).toEqual([]);
  });

  it('says it can\'t tell while the file can\'t be read, rather than "none"', () => {
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, groups: [billing] });
    mockReadFileSync.mockImplementation(() => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); });
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
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, groups: [billing] });
    saveConversationGroups('everything');
    flushPendingSaves();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(loadConversationGroups()).toEqual([billing]);
  });
});
