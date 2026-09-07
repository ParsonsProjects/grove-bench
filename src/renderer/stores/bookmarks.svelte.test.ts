import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { bookmarkStore } from './bookmarks.svelte.js';
import type { Bookmark } from '../../shared/types.js';

let counter = 0;
function bm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: `id-${++counter}`,
    sessionId: 's1',
    repoPath: '/repo',
    sessionLabel: 'main',
    messageUuid: 'u1',
    eventIndex: 1,
    selectedText: 'code',
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bookmarkStore.list = [];
  bookmarkStore.loading = true;
  bookmarkStore.drawerOpen = false;
});

describe('load', () => {
  it('populates the list from IPC and clears loading', async () => {
    const seed = [bm(), bm()];
    mockGroveBench.listBookmarks.mockResolvedValueOnce(seed);

    await bookmarkStore.load();

    expect(bookmarkStore.list).toEqual(seed);
    expect(bookmarkStore.loading).toBe(false);
  });
});

describe('add', () => {
  it('sends the payload to IPC and prepends the created bookmark', async () => {
    const created = bm({ id: 'server-id', selectedText: 'new' });
    mockGroveBench.addBookmark.mockResolvedValueOnce(created);
    bookmarkStore.list = [bm({ id: 'existing' })];

    const payload = {
      sessionId: 's1', repoPath: '/repo', sessionLabel: 'main',
      messageUuid: 'u1', eventIndex: 1, selectedText: 'new',
    };
    const result = await bookmarkStore.add(payload);

    expect(mockGroveBench.addBookmark).toHaveBeenCalledWith(expect.objectContaining({ selectedText: 'new' }));
    expect(result).toBe(created);
    expect(bookmarkStore.list[0]).toStrictEqual(created);
    expect(bookmarkStore.list).toHaveLength(2);
  });
});

describe('remove', () => {
  it('calls IPC and drops the bookmark from the list', async () => {
    bookmarkStore.list = [bm({ id: 'a' }), bm({ id: 'b' })];

    await bookmarkStore.remove('a');

    expect(mockGroveBench.removeBookmark).toHaveBeenCalledWith('a');
    expect(bookmarkStore.list.map((b) => b.id)).toEqual(['b']);
  });
});

describe('updateNote', () => {
  it('patches the note via IPC and updates the list', async () => {
    bookmarkStore.list = [bm({ id: 'a' })];

    await bookmarkStore.updateNote('a', 'remember');

    expect(mockGroveBench.updateBookmark).toHaveBeenCalledWith('a', { note: 'remember' });
    expect(bookmarkStore.list[0].note).toBe('remember');
  });
});

describe('patchEventIndex', () => {
  it('patches the cached eventIndex via IPC and updates the list', async () => {
    bookmarkStore.list = [bm({ id: 'a', eventIndex: null })];

    await bookmarkStore.patchEventIndex('a', 99);

    expect(mockGroveBench.updateBookmark).toHaveBeenCalledWith('a', { eventIndex: 99 });
    expect(bookmarkStore.list[0].eventIndex).toBe(99);
  });
});

describe('dropSessionLocal', () => {
  it('removes a session\'s bookmarks without calling IPC', () => {
    bookmarkStore.list = [
      bm({ id: 'a', sessionId: 's1' }),
      bm({ id: 'b', sessionId: 's2' }),
      bm({ id: 'c', sessionId: 's1' }),
    ];

    bookmarkStore.dropSessionLocal('s1');

    expect(bookmarkStore.list.map((b) => b.id)).toEqual(['b']);
    expect(mockGroveBench.removeBookmark).not.toHaveBeenCalled();
  });
});

describe('grouped', () => {
  it('groups by repo then session, preserving list order', () => {
    bookmarkStore.list = [
      bm({ id: '1', repoPath: '/r1', sessionId: 's1', sessionLabel: 'feat-a' }),
      bm({ id: '2', repoPath: '/r1', sessionId: 's1', sessionLabel: 'feat-a' }),
      bm({ id: '3', repoPath: '/r1', sessionId: 's2', sessionLabel: 'feat-b' }),
      bm({ id: '4', repoPath: '/r2', sessionId: 's3', sessionLabel: 'main' }),
    ];

    const grouped = bookmarkStore.grouped;

    expect(grouped.map((r) => r.repoPath)).toEqual(['/r1', '/r2']);
    expect(grouped[0].sessions.map((s) => s.sessionId)).toEqual(['s1', 's2']);
    expect(grouped[0].sessions[0].bookmarks.map((b) => b.id)).toEqual(['1', '2']);
    expect(grouped[1].sessions[0].sessionLabel).toBe('main');
  });
});

describe('toggleDrawer', () => {
  it('toggles when called without an argument', () => {
    expect(bookmarkStore.drawerOpen).toBe(false);
    bookmarkStore.toggleDrawer();
    expect(bookmarkStore.drawerOpen).toBe(true);
    bookmarkStore.toggleDrawer();
    expect(bookmarkStore.drawerOpen).toBe(false);
  });

  it('sets the explicit state when given an argument', () => {
    bookmarkStore.toggleDrawer(true);
    expect(bookmarkStore.drawerOpen).toBe(true);
    bookmarkStore.toggleDrawer(true);
    expect(bookmarkStore.drawerOpen).toBe(true);
  });
});
