import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { Bookmark } from '../shared/types.js';

/** Max stored snippet length — keeps bookmarks.json small. */
const MAX_TEXT = 2000;

let cached: Bookmark[] | null = null;

function getBookmarksPath(): string {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

function persist(): void {
  try {
    fs.writeFileSync(getBookmarksPath(), JSON.stringify(cached ?? [], null, 2));
  } catch {
    /* ignore write errors */
  }
}

export function loadBookmarks(): Bookmark[] {
  try {
    const data = fs.readFileSync(getBookmarksPath(), 'utf-8');
    const parsed = JSON.parse(data);
    cached = Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

export function getBookmarks(): Bookmark[] {
  if (!cached) return loadBookmarks();
  return cached;
}

export function addBookmark(input: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark {
  const list = getBookmarks();
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
  const list = getBookmarks();
  cached = list.filter((b) => b.id !== id);
  persist();
}

export function updateBookmark(
  id: string,
  patch: Partial<Pick<Bookmark, 'note' | 'eventIndex'>>,
): void {
  const list = getBookmarks();
  cached = list.map((b) => (b.id === id ? { ...b, ...patch } : b));
  persist();
}

export function removeBookmarksForSession(sessionId: string): void {
  const list = getBookmarks();
  cached = list.filter((b) => b.sessionId !== sessionId);
  persist();
}
