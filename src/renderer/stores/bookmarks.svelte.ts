import type { Bookmark } from '../../shared/types.js';

export interface BookmarkSessionGroup {
  sessionId: string;
  sessionLabel: string;
  bookmarks: Bookmark[];
}

export interface BookmarkRepoGroup {
  repoPath: string;
  sessions: BookmarkSessionGroup[];
}

class BookmarkStore {
  /** All bookmarks, newest-first (the order returned by / maintained against main). */
  list = $state<Bookmark[]>([]);
  loading = $state(true);
  drawerOpen = $state(false);

  async load() {
    try {
      this.list = await window.groveBench.listBookmarks();
    } finally {
      this.loading = false;
    }
  }

  async add(payload: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark> {
    const created = await window.groveBench.addBookmark(
      $state.snapshot(payload),
    );
    this.list = [created, ...this.list];
    return created;
  }

  async remove(id: string) {
    await window.groveBench.removeBookmark(id);
    this.list = this.list.filter((b) => b.id !== id);
  }

  async updateNote(id: string, note: string) {
    await window.groveBench.updateBookmark(id, { note });
    this.list = this.list.map((b) => (b.id === id ? { ...b, note } : b));
  }

  /** Save where a bookmark's event turned out to be. Only a cache (a jump
   *  finds the event by uuid without it), so a failed save is logged, not
   *  thrown. */
  async patchEventIndex(id: string, eventIndex: number) {
    try {
      await window.groveBench.updateBookmark(id, { eventIndex });
    } catch (e) {
      console.warn("[bookmarks] couldn't save a bookmark's event index:", e);
      return;
    }
    this.list = this.list.map((b) => (b.id === id ? { ...b, eventIndex } : b));
  }

  /** Drop a session's bookmarks from the in-memory list. Main already cascade-
   *  deletes them from disk on SESSION_DESTROY, so this needs no IPC round-trip. */
  dropSessionLocal(sessionId: string) {
    this.list = this.list.filter((b) => b.sessionId !== sessionId);
  }

  toggleDrawer(open?: boolean) {
    this.drawerOpen = open ?? !this.drawerOpen;
  }

  /** Group by repo → session, preserving the list's newest-first ordering within
   *  each group (and the order in which repos/sessions first appear). */
  get grouped(): BookmarkRepoGroup[] {
    const repos: BookmarkRepoGroup[] = [];
    for (const b of this.list) {
      let repo = repos.find((r) => r.repoPath === b.repoPath);
      if (!repo) {
        repo = { repoPath: b.repoPath, sessions: [] };
        repos.push(repo);
      }
      let session = repo.sessions.find((s) => s.sessionId === b.sessionId);
      if (!session) {
        session = { sessionId: b.sessionId, sessionLabel: b.sessionLabel, bookmarks: [] };
        repo.sessions.push(session);
      }
      session.bookmarks.push(b);
    }
    return repos;
  }
}

export const bookmarkStore = new BookmarkStore();
