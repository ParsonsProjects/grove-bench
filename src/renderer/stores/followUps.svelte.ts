/**
 * Follow-ups (shared/follow-ups.ts): work agents found for later threads,
 * kept by main in follow-ups.json. Main sends what changed after every save,
 * an agent's included, so the drawer shows one the moment it is added.
 * Starting a thread from one fills the New thread draft
 * (draftStore.openFollowUp), and the thread is noted against it once it starts.
 */
import { applyFollowUpsChange, type FollowUp, type FollowUpsChange } from '../../shared/follow-ups.js';
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
  /** Every project's follow-ups, oldest first. */
  list = $state<FollowUp[]>([]);
  /** The list has been read. Until then the drawer says it is loading. */
  ready = $state(false);
  /** Every attempt to read it failed: the drawer offers to try again. */
  loadFailed = $state(false);
  drawerOpen = $state(false);
  /** When the drawer was last opened (dock.svelte: nextOpening). */
  opening = $state(0);

  // The drawer's own state, kept here rather than in the drawer: it moves
  // to another dock (and mounts again) whenever the thread on screen changes.
  /** Why the drawer's last action didn't happen, until the next one. */
  notice = $state<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  /** Follow-ups whose details are shown in full. */
  expanded = $state(new Set<string>());
  /** Projects whose done follow-ups are shown. */
  showDone = $state(new Set<string>());
  /** The follow-up the drawer was opened to show (reveal): highlighted,
   *  and scrolled to, until the drawer closes or another is shown. */
  revealId = $state<string | null>(null);

  private unsubscribe: (() => void) | null = null;
  /** Changes that arrived before the list was read, applied to it once it is. */
  private pending: FollowUpsChange[] = [];

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    // Listen first, so a change while the list loads isn't missed.
    this.unsubscribe ??= window.groveBench.onFollowUpsChanged((change) => {
      if (this.ready) {
        this.list = applyFollowUpsChange(this.list, change);
        return;
      }
      this.pending.push(change);
      // Main just saved the file, so it can likely be read now.
      if (this.loadFailed) void this.load(retryMs);
    });
    this.loadFailed = false;
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS && !this.ready; attempt++) {
      try {
        const list = await window.groveBench.listFollowUps();
        if (list && !this.ready) {
          // Changes are safe to apply twice, so one the answer already has is fine.
          this.list = this.pending.reduce(applyFollowUpsChange, list);
          this.pending = [];
          this.ready = true;
          return;
        }
      } catch (e) {
        console.warn('[follow-ups] could not load follow-ups:', e);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    if (!this.ready) {
      this.loadFailed = true;
      console.warn('[follow-ups] follow-ups.json stayed unreadable');
    }
  }

  /** Open follow-ups in these projects, for the sidebar button's count. A
   *  removed project's can't be started, so they aren't counted. */
  openCountIn(repos: readonly string[]): number {
    const projects = new Set(repos);
    return this.list.filter((f) => f.doneAt === undefined && projects.has(f.repoPath)).length;
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

  /** The follow-up a thread was started from (Start thread notes it once
   *  the thread starts), or undefined. One started more than once (Start
   *  another) names each of its threads. */
  startedFrom(sessionId: string): FollowUp | undefined {
    return this.list.find((f) => f.startedSessionIds?.includes(sessionId));
  }

  /** Open the drawer at one follow-up: its details in full, and its
   *  project's done ones shown when it is done, so it is on screen. */
  reveal(id: string): void {
    const f = this.get(id);
    if (!f) return;
    this.expanded = new Set([...this.expanded, id]);
    if (f.doneAt !== undefined) this.showDone = new Set([...this.showDone, f.repoPath]);
    this.notice = null;
    this.revealId = id;
    this.toggleDrawer(true);
  }

  setDone(id: string, done: boolean): Promise<void> {
    return window.groveBench.setFollowUpDone(id, done);
  }

  remove(id: string): Promise<void> {
    return window.groveBench.removeFollowUp(id);
  }

  /** Add one by hand (FollowUpForm). Resolves with what main kept: an open
   *  one with the same title instead, when there is one (`existing`). The
   *  list shows it at once, without waiting for main's change. */
  async add(repoPath: string, title: string, details: string): Promise<{ followUp: FollowUp; existing: boolean }> {
    const result = await window.groveBench.addFollowUp(repoPath, title, details);
    if (this.ready && !result.existing) this.list = applyFollowUpsChange(this.list, { upserted: [result.followUp], removed: [] });
    return result;
  }

  /** The New follow-up dialog is open (FollowUpDialog), for this project
   *  (empty: the first one; the dialog can change it). */
  addingIn = $state<{ repoPath: string } | null>(null);

  openAdd(repoPath = ''): void {
    this.addingIn = { repoPath };
  }

  closeAdd(): void {
    this.addingIn = null;
  }

  /** How many open follow-ups a project has: main takes no more than
   *  FOLLOW_UP_LIMITS.openPerProject. */
  openIn(repoPath: string): number {
    return this.list.filter((f) => f.repoPath === repoPath && f.doneAt === undefined).length;
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
    if (!this.drawerOpen) {
      this.notice = null;
      this.revealId = null;
    }
  }
}

export const followUpsStore = new FollowUpsStore();
