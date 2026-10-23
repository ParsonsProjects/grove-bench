import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { Bookmark } from '../shared/types.js';
import { readJsonFile, writeFileAtomicSync } from './json-file.js';
import { logger } from './logger.js';

/** Max stored snippet length — keeps bookmarks.json small. */
const MAX_TEXT = 2000;

let cached: Bookmark[] | null = null;

function getBookmarksPath(): string {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

function persist(): void {
  try {
    writeFileAtomicSync(getBookmarksPath(), JSON.stringify(cached ?? [], null, 2));
  } catch (err) {
    logger.warn('[bookmarks] could not save bookmarks:', err);
  }
}

/** The saved list (empty when missing or damaged), or null when the file
 *  exists but can't be read right now. */
function readBookmarks(): Bookmark[] | null {
  const read = readJsonFile(getBookmarksPath());
  if (read.kind === 'unreadable') return null;
  return read.kind === 'ok' && Array.isArray(read.value) ? (read.value as Bookmark[]) : [];
}

export function loadBookmarks(): Bookmark[] {
  const list = readBookmarks();
  // Unreadable: keep what was read before. With nothing yet, show none but
  // don't cache that, so the next call reads the file again.
  if (!list) return cached ?? [];
  cached = list;
  return cached;
}

export function getBookmarks(): Bookmark[] {
  if (!cached) return loadBookmarks();
  return cached;
}

/** The list to change. Throws when the file can't be read, rather than save
 *  a list that is missing everything in it. */
function bookmarksForUpdate(): Bookmark[] {
  if (cached) return cached;
  const list = readBookmarks();
  if (!list) throw new Error("Couldn't read your saved bookmarks, so nothing was changed. Try again in a moment.");
  cached = list;
  return cached;
}

export function addBookmark(input: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark {
  const list = bookmarksForUpdate();
  const bookmark: Bookmark = {
    ...input,
    selectedText: (input.selectedText ?? '').slice(0, MAX_TEXT),
    id: randomUUID(),
    createdAt: Date.now(),
  };
  cached = [bookmark, ...list];
  persist();
  return bookmark;
}

export function removeBookmark(id: string): void {
  const list = bookmarksForUpdate();
  cached = list.filter((b) => b.id !== id);
  persist();
}

export function updateBookmark(
  id: string,
  patch: Partial<Pick<Bookmark, 'note' | 'eventIndex'>>,
): void {
  const list = bookmarksForUpdate();
  cached = list.map((b) => (b.id === id ? { ...b, ...patch } : b));
  persist();
}

export function removeBookmarksForSession(sessionId: string): void {
  const list = bookmarksForUpdate();
  cached = list.filter((b) => b.sessionId !== sessionId);
  persist();
}

/** Test hook: forget the cached list, as at app start. */
export function resetBookmarksCache(): void {
  cached = null;
}
