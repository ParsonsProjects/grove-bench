import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import BookmarksDrawer from './BookmarksDrawer.svelte';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { Bookmark } from '../../shared/types.js';

let n = 0;
function bm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: `b${++n}`,
    sessionId: 's1',
    repoPath: '/repo-a',
    sessionLabel: 'feat-x',
    messageUuid: 'u1',
    eventIndex: 3,
    selectedText: 'const answer = 42;',
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  bookmarkStore.list = [];
  bookmarkStore.drawerOpen = true;
  store.sessions = [];
  store.activeSessionId = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  bookmarkStore.drawerOpen = false;
});

describe('BookmarksDrawer', () => {
  it('renders nothing when the drawer is closed', () => {
    bookmarkStore.drawerOpen = false;
    render(BookmarksDrawer);
    expect(screen.queryByText('Bookmarks')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no bookmarks', () => {
    render(BookmarksDrawer);
    expect(screen.getByText(/No bookmarks yet/i)).toBeInTheDocument();
  });

  it('renders bookmark snippets grouped under their session', () => {
    bookmarkStore.list = [bm({ id: 'a', selectedText: 'first snippet' })];
    render(BookmarksDrawer);
    expect(screen.getByText('first snippet')).toBeInTheDocument();
    expect(screen.getByText('feat-x')).toBeInTheDocument();
  });

  it('delete calls the store and removes the row', async () => {
    const removeSpy = vi.spyOn(bookmarkStore, 'remove').mockResolvedValue();
    bookmarkStore.list = [bm({ id: 'a', selectedText: 'doomed' })];
    render(BookmarksDrawer);

    await fireEvent.click(screen.getByTitle('Delete bookmark'));

    expect(removeSpy).toHaveBeenCalledWith('a');
  });

  it('Jump switches the active session and requests a jump when the session is open', async () => {
    const requestSpy = vi.spyOn(messageStore, 'requestJump');
    store.sessions = [{ id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running' }] as any;
    bookmarkStore.list = [bm({ id: 'a', sessionId: 's1', eventIndex: 7, messageUuid: 'uX' })];
    render(BookmarksDrawer);

    await fireEvent.click(screen.getByTitle('Jump to source'));

    expect(store.activeSessionId).toBe('s1');
    expect(requestSpy).toHaveBeenCalledWith('s1', { eventIndex: 7, uuid: 'uX', bookmarkId: 'a' });
    expect(bookmarkStore.drawerOpen).toBe(false);
  });

  it('Jump does nothing when the bookmark\'s session is no longer open', async () => {
    const requestSpy = vi.spyOn(messageStore, 'requestJump');
    store.sessions = []; // session gone
    bookmarkStore.list = [bm({ id: 'a', sessionId: 'gone' })];
    render(BookmarksDrawer);

    await fireEvent.click(screen.getByTitle('Jump to source'));

    expect(requestSpy).not.toHaveBeenCalled();
    expect(bookmarkStore.drawerOpen).toBe(true); // stays open so the text is visible
  });
});
