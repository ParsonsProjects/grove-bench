import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  },
}));

import {
  loadAppState, saveOpenTabs, saveUnreadSessionIds, loadUnreadSessionIds,
  saveKnownSkills, flushPendingSaves, validateAppState, upgradeAppState, APP_STATE_SCHEMA_VERSION,
  loadPrerequisiteCache, loadModelCatalog, saveModelCatalog,
} from './app-state.js';

/** The file as the last write left it, so read-modify-write chains see their own updates. */
function useDisk(initial: unknown) {
  let disk = initial === undefined ? null : JSON.stringify(initial);
  mockReadFileSync.mockImplementation(() => {
    if (disk === null) throw new Error('ENOENT');
    return disk;
  });
  mockWriteFileSync.mockImplementation((_p: string, data: string) => { disk = data; });
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

  it('write-through helpers merge into the existing file', () => {
    const disk = useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, knownSkills: { '/a': ['x'] } });
    saveKnownSkills('/b', ['y']);
    expect(disk.get().knownSkills).toEqual({ '/a': ['x'], '/b': ['y'] });
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
