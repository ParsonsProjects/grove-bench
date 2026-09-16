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
  loadAppState, saveActiveTab, saveOpenTabs, saveUnreadSessionIds, loadUnreadSessionIds,
  saveKnownSkills, flushPendingSaves, validateAppState, upgradeAppState, APP_STATE_SCHEMA_VERSION,
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
    expect(s.activeTabId).toBeNull();
    expect(s.openTabIds).toEqual([]);
    expect(s.sessionSort).toEqual({ key: 'name', dir: 'asc' });
  });

  it('returns defaults on corrupt JSON', () => {
    mockReadFileSync.mockReturnValue('{not json');
    expect(loadAppState().openTabIds).toEqual([]);
  });

  it('stamps an unversioned file on first load', () => {
    const disk = useDisk({ activeTabId: 'a', openTabIds: ['a', 'b'] });
    const s = loadAppState();
    expect(s.activeTabId).toBe('a');
    expect(s.openTabIds).toEqual(['a', 'b']);
    expect(disk.get().schemaVersion).toBe(APP_STATE_SCHEMA_VERSION);
  });

  it('does not rewrite a current-version file', () => {
    useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, activeTabId: 'a' });
    loadAppState();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('validateAppState', () => {
  it('resets only the corrupt fields', () => {
    const s = validateAppState({
      activeTabId: 42,
      openTabIds: ['x', 3],
      collapsedRepos: { '/r': true },
      sessionSort: { key: 'size', dir: 'asc' },
      sidebarWidth: 'wide',
      unreadSessionIds: ['u1'],
    });
    expect(s.activeTabId).toBeNull();
    expect(s.openTabIds).toEqual([]);
    expect(s.collapsedRepos).toEqual({ '/r': true });
    expect(s.sessionSort).toEqual({ key: 'name', dir: 'asc' });
    expect(s.sidebarWidth).toBeNull();
    expect(s.unreadSessionIds).toEqual(['u1']);
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
    const { state } = upgradeAppState({ schemaVersion: APP_STATE_SCHEMA_VERSION + 1, activeTabId: 'z', future: 1 });
    expect(state.activeTabId).toBe('z');
    expect((state as any).future).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('debounced writers', () => {
  it('coalesces rapid saves into one write and keeps other fields', () => {
    const disk = useDisk({ schemaVersion: APP_STATE_SCHEMA_VERSION, openTabIds: ['keep'] });
    saveActiveTab('a');
    saveActiveTab('b');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(disk.get()).toMatchObject({ schemaVersion: APP_STATE_SCHEMA_VERSION, activeTabId: 'b', openTabIds: ['keep'] });
  });

  it('flushPendingSaves writes every pending field immediately', () => {
    const disk = useDisk(undefined);
    saveActiveTab('a');
    saveOpenTabs(['a']);
    saveUnreadSessionIds(['u']);
    flushPendingSaves();
    expect(disk.get()).toMatchObject({ activeTabId: 'a', openTabIds: ['a'], unreadSessionIds: ['u'] });
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
