import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available when the mock factory runs
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
  loadBookmarks,
  getBookmarks,
  addBookmark,
  removeBookmark,
  updateBookmark,
  removeBookmarksForSession,
} from './bookmarks.js';

// Simulated disk so writeFileSync -> readFileSync round-trips work.
let disk: string | null;

function wireDisk() {
  disk = null;
  mockReadFileSync.mockImplementation(() => {
    if (disk == null) throw new Error('ENOENT');
    return disk;
  });
  mockWriteFileSync.mockImplementation((_path: string, data: string) => {
    disk = data;
  });
}

const base = {
  sessionId: 's1',
  repoPath: '/repo',
  sessionLabel: 'main',
  messageUuid: 'u1',
  eventIndex: 3,
  selectedText: 'const x = 1;',
};

beforeEach(() => {
  vi.clearAllMocks();
  wireDisk();
  loadBookmarks(); // reset module cache to empty
});

describe('loadBookmarks', () => {
  it('returns an empty list when the file does not exist', () => {
    expect(loadBookmarks()).toEqual([]);
  });

  it('returns an empty list on corrupt JSON', () => {
    disk = 'not valid json {{{';
    expect(loadBookmarks()).toEqual([]);
  });

  it('coerces a non-array payload to an empty list', () => {
    disk = JSON.stringify({ nope: true });
    expect(loadBookmarks()).toEqual([]);
  });
});

describe('addBookmark', () => {
  it('assigns id + createdAt and returns the created bookmark', () => {
    const created = addBookmark(base);
    expect(created.id).toBeTruthy();
    expect(typeof created.createdAt).toBe('number');
    expect(created.sessionId).toBe('s1');
    expect(created.selectedText).toBe('const x = 1;');
  });

  it('prepends so the newest bookmark is first', () => {
    addBookmark({ ...base, selectedText: 'first' });
    addBookmark({ ...base, selectedText: 'second' });
    const list = getBookmarks();
    expect(list).toHaveLength(2);
    expect(list[0].selectedText).toBe('second');
    expect(list[1].selectedText).toBe('first');
  });

  it('caps selectedText length', () => {
    const created = addBookmark({ ...base, selectedText: 'x'.repeat(5000) });
    expect(created.selectedText.length).toBe(2000);
  });

  it('persists to disk', () => {
    addBookmark(base);
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(disk).toContain('const x = 1;');
  });
});

describe('removeBookmark', () => {
  it('removes a bookmark by id', () => {
    const a = addBookmark({ ...base, selectedText: 'a' });
    addBookmark({ ...base, selectedText: 'b' });
    removeBookmark(a.id);
    const list = getBookmarks();
    expect(list).toHaveLength(1);
    expect(list[0].selectedText).toBe('b');
  });

  it('is a no-op for an unknown id', () => {
    addBookmark(base);
    removeBookmark('missing');
    expect(getBookmarks()).toHaveLength(1);
  });
});

describe('updateBookmark', () => {
  it('patches the note', () => {
    const a = addBookmark(base);
    updateBookmark(a.id, { note: 'remember this' });
    expect(getBookmarks()[0].note).toBe('remember this');
  });

  it('patches the cached eventIndex', () => {
    const a = addBookmark({ ...base, eventIndex: null });
    updateBookmark(a.id, { eventIndex: 42 });
    expect(getBookmarks()[0].eventIndex).toBe(42);
  });

  it('leaves other bookmarks untouched', () => {
    const a = addBookmark({ ...base, selectedText: 'a' });
    const b = addBookmark({ ...base, selectedText: 'b' });
    updateBookmark(a.id, { note: 'x' });
    const list = getBookmarks();
    expect(list.find((m) => m.id === b.id)?.note).toBeUndefined();
  });
});

describe('removeBookmarksForSession', () => {
  it('removes every bookmark for the given session', () => {
    addBookmark({ ...base, sessionId: 's1' });
    addBookmark({ ...base, sessionId: 's1' });
    addBookmark({ ...base, sessionId: 's2' });
    removeBookmarksForSession('s1');
    const list = getBookmarks();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('s2');
  });
});

describe('persistence round-trip', () => {
  it('reloads what was written from disk', () => {
    const created = addBookmark(base);
    // Drop the in-memory cache and re-read from the simulated disk.
    const reloaded = loadBookmarks();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(created.id);
    expect(reloaded[0].selectedText).toBe('const x = 1;');
  });
});
