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

  describe('links', () => {
    const web = { kind: 'web' as const, href: 'https://docs.example.dev/setup', text: 'setup guide' };
    const file = { kind: 'file' as const, href: 'docs/plan.md#L3', text: 'the plan' };

    it('lists them under the snippet with where they go', () => {
      bookmarkStore.list = [bm({ id: 'a', links: [web, file] })];
      render(BookmarksDrawer);
      const list = screen.getByRole('list', { name: 'Links in this bookmark' });
      expect(list).toHaveTextContent('setup guide');
      expect(list).toHaveTextContent('docs.example.dev');
      expect(list).toHaveTextContent('the plan');
      expect(list).toHaveTextContent('docs/plan.md#L3');
    });

    it("doesn't repeat an address its text already says", () => {
      const bare = { kind: 'web' as const, href: 'https://example.com/a', text: 'https://example.com/a' };
      bookmarkStore.list = [bm({ id: 'a', links: [bare] })];
      render(BookmarksDrawer);
      expect(screen.getByRole('list', { name: 'Links in this bookmark' }).textContent?.trim()).toBe('https://example.com/a');
    });

    it('shows none for a bookmark saved without them', () => {
      bookmarkStore.list = [bm({ id: 'a' })];
      render(BookmarksDrawer);
      expect(screen.queryByRole('list', { name: 'Links in this bookmark' })).not.toBeInTheDocument();
    });

    it('opens a web link in the system browser', async () => {
      bookmarkStore.list = [bm({ id: 'a', links: [web] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle(web.href));
      expect(window.groveBench.openExternal).toHaveBeenCalledWith(web.href);
    });

    it("opens a file link in its own thread's worktree, showing that thread", async () => {
      vi.mocked(window.groveBench.openWorktreeFile).mockResolvedValueOnce({ kind: 'markdown', content: '# Plan' });
      store.sessions = [
        { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running' },
        { id: 's2', branch: 'other', repoPath: '/repo-a', status: 'running' },
      ] as any;
      store.activeSessionId = 's2';
      bookmarkStore.list = [bm({ id: 'a', sessionId: 's1', links: [file] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle(file.href));
      expect(window.groveBench.openWorktreeFile).toHaveBeenLastCalledWith('s1', 'docs/plan.md');
      await vi.waitFor(() => expect(store.activeSessionId).toBe('s1'));
    });

    it('stays in the thread you are in for a file another app opens', async () => {
      vi.mocked(window.groveBench.openWorktreeFile).mockResolvedValueOnce({ kind: 'opened' });
      store.sessions = [
        { id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'stopped' },
        { id: 's2', branch: 'other', repoPath: '/repo-a', status: 'running' },
      ] as any;
      store.activeSessionId = 's2';
      const pdf = { kind: 'file' as const, href: 'out/report.pdf', text: 'report' };
      bookmarkStore.list = [bm({ id: 'a', sessionId: 's1', links: [pdf] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle(pdf.href));
      await vi.waitFor(() => expect(window.groveBench.openWorktreeFile).toHaveBeenLastCalledWith('s1', 'out/report.pdf'));
      await new Promise((r) => setTimeout(r, 0));
      expect(store.activeSessionId).toBe('s2');
    });

    it("opens a local page in its own thread's Preview tab, even from the landing", async () => {
      const local = { kind: 'web' as const, href: 'http://localhost:5173/', text: 'the app' };
      store.sessions = [{ id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running' }] as any;
      bookmarkStore.list = [bm({ id: 'a', sessionId: 's1', links: [local] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle(local.href));
      expect(store.activeSessionId).toBe('s1');
      expect(messageStore.getActiveTab('s1')).toBe('preview');
    });

    it('copies its text with its links written in', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      bookmarkStore.list = [bm({ id: 'a', selectedText: 'See the setup guide', links: [web] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle('Copy'));
      expect(writeText).toHaveBeenCalledWith('See the [setup guide](https://docs.example.dev/setup)');
    });

    it("says so when the file isn't in the worktree", async () => {
      vi.mocked(window.groveBench.openWorktreeFile).mockResolvedValueOnce({ kind: 'missing' });
      store.sessions = [{ id: 's1', branch: 'feat-x', repoPath: '/repo-a', status: 'running' }] as any;
      bookmarkStore.list = [bm({ id: 'a', sessionId: 's1', links: [file] })];
      render(BookmarksDrawer);
      await fireEvent.click(screen.getByTitle(file.href));
      expect(await screen.findByText("(not found in this thread's worktree)")).toBeInTheDocument();
    });

    it("can't open a file link once its thread is gone", () => {
      bookmarkStore.list = [bm({ id: 'a', sessionId: 'gone', links: [file] })];
      render(BookmarksDrawer);
      expect(screen.getByTitle(`${file.href} (its thread isn't open)`)).toBeDisabled();
    });
  });
});
