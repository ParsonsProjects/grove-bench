/**
 * Follow-ups (shared/follow-ups.ts): work agents found for later threads,
 * kept by main in follow-ups.json. Main sends the whole list after every
 * change, an agent's included, so the drawer shows one the moment it is
 * added. Starting a thread from one fills the New thread draft
 * (draftStore.openFollowUp), and the thread is noted against it once it starts.
 */
import type { FollowUp } from '../../shared/follow-ups.js';
import { nextOpening } from './dock.svelte.js';

/** How often, and how many times, to ask again while follow-ups.json can't
 *  be read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

export interface FollowUpProject {
  repoPath: string;
  open: FollowUp[];
  done: FollowUp[];
}

class FollowUpsStore {
  /** Every project's follow-ups, as main last sent them (oldest first). */
  list = $state<FollowUp[]>([]);
  /** The list has been read. Until then the drawer says it is loading. */
  ready = $state(false);
  drawerOpen = $state(false);
  /** When the drawer was last opened (dock.svelte: nextOpening). */
  opening = $state(0);

  /** Open ones in every project, for the sidebar button's count. */
  openCount = $derived(this.list.filter((f) => f.doneAt === undefined).length);

  private unsubscribe: (() => void) | null = null;

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    // Listen first, so a change while the list loads isn't missed.
    this.unsubscribe ??= window.groveBench.onFollowUpsChanged((list) => {
      this.list = list;
      this.ready = true;
    });
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS && !this.ready; attempt++) {
      try {
        const list = await window.groveBench.listFollowUps();
        if (list) {
          // A change pushed while this loaded is newer than the answer.
          if (!this.ready) this.list = list;
          this.ready = true;
          return;
        }
      } catch (e) {
        console.warn('[follow-ups] could not load follow-ups:', e);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    if (!this.ready) console.warn('[follow-ups] follow-ups.json stayed unreadable; the list shows once something changes it');
  }

  /** Each project with follow-ups: open ones oldest first (the order they
   *  came up), done ones most recent first. Projects in `repoOrder` first, in
   *  that order, then any others (a removed project's). */
  byProject(repoOrder: readonly string[]): FollowUpProject[] {
    const projects = new Map<string, FollowUpProject>();
    for (const f of this.list) {
      let p = projects.get(f.repoPath);
      if (!p) projects.set(f.repoPath, p = { repoPath: f.repoPath, open: [], done: [] });
      (f.doneAt === undefined ? p.open : p.done).push(f);
    }
    for (const p of projects.values()) p.done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    const rank = (repo: string) => {
      const i = repoOrder.indexOf(repo);
      return i === -1 ? repoOrder.length : i;
    };
    return [...projects.values()].sort((a, b) => rank(a.repoPath) - rank(b.repoPath));
  }

  get(id: string): FollowUp | undefined {
    return this.list.find((f) => f.id === id);
  }

  setDone(id: string, done: boolean): Promise<void> {
    return window.groveBench.setFollowUpDone(id, done);
  }

  remove(id: string): Promise<void> {
    return window.groveBench.removeFollowUp(id);
  }

  /** Note the thread started from it. Only shown in the drawer, so a
   *  failure is logged, not thrown. */
  async started(id: string, sessionId: string): Promise<void> {
    try {
      await window.groveBench.followUpStarted(id, sessionId);
    } catch (e) {
      console.warn("[follow-ups] couldn't note the thread started from a follow-up:", e);
    }
  }

  toggleDrawer(open?: boolean): void {
    const wasOpen = this.drawerOpen;
    this.drawerOpen = open ?? !this.drawerOpen;
    if (this.drawerOpen && !wasOpen) this.opening = nextOpening();
  }
}

export const followUpsStore = new FollowUpsStore();
