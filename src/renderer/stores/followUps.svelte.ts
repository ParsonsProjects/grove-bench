/**
 * Follow-ups (shared/follow-ups.ts): work agents found for later threads,
 * kept by main in follow-ups.json. Main sends what changed after every save,
 * an agent's included, so the drawer shows one the moment it is added.
 * Starting a thread from one fills the New thread draft
 * (draftStore.openFollowUp), and the thread is noted against it once it starts.
 */
import {
  applyFollowUpsChange,
  byFollowUpPriority,
  followUpEndedAt,
  isFollowUpOpen,
  type FollowUp,
  type FollowUpPriority,
  type FollowUpsChange,
} from '../../shared/follow-ups.js';
import { nextOpening } from './dock.svelte.js';

/** How often, and how many times, to ask again while follow-ups.json can't
 *  be read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

export interface FollowUpProject {
  repoPath: string;
  open: FollowUp[];
  /** Done and closed ones, most recent first. */
  ended: FollowUp[];
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
  /** In-progress follow-ups (a thread started from one is open) shown as a
   *  full card rather than one line. */
  unfolded = $state(new Set<string>());
  /** Projects whose done and closed follow-ups are shown. */
  showEnded = $state(new Set<string>());
  /** Projects folded down to their heading, by path. Saved in app state, so
   *  they stay folded after a restart. */
  collapsed = $state(new Set<string>());
  /** Where the drawer's list was scrolled to when it last unmounted, so it
   *  opens there again. Not reactive: only read as the list mounts. */
  scrollTop = 0;
  /** The follow-up the drawer was opened to show (reveal): highlighted,
   *  and scrolled to, until the drawer closes or another is shown. */
  revealId = $state<string | null>(null);
  /** Counts reveals, so showing the same follow-up again scrolls to it again. */
  revealCount = $state(0);

  private unsubscribe: (() => void) | null = null;
  /** Changes that arrived before the list was read, applied to it once it is. */
  private pending: FollowUpsChange[] = [];
  private collapsedLoad: Promise<void> | null = null;
  /** The saved folds have been read (or couldn't be): changes are saved. */
  private collapsedReady = false;
  /** Folds and unfolds made while the saved ones load: true folded. Laid
   *  over the saved list once it is read, then saved, so neither undoes the
   *  other. */
  private foldsWhileLoading = new Map<string, boolean>();
  /** The in-progress follow-up reveal unfolded, to fold again as the drawer
   *  closes. Null when it was already unfolded (you did that). */
  private revealUnfolded: string | null = null;

  /** The folded projects, read once. A fold made while it loads wins. */
  loadCollapsed(): Promise<void> {
    this.collapsedLoad ??= (async () => {
      let saved: string[] = [];
      try {
        const read = await window.groveBench.getCollapsedFollowUpProjects();
        if (Array.isArray(read)) saved = read;
      } catch (e) {
        console.warn('[follow-ups] could not read the folded projects:', e);
      }
      const next = new Set(saved);
      for (const [repoPath, fold] of this.foldsWhileLoading) {
        if (fold) next.add(repoPath);
        else next.delete(repoPath);
      }
      const changed = this.foldsWhileLoading.size > 0;
      this.foldsWhileLoading.clear();
      this.collapsed = next;
      this.collapsedReady = true;
      if (changed) this.saveCollapsed();
      this.pruneCollapsed();
    })();
    return this.collapsedLoad;
  }

  isCollapsed(repoPath: string): boolean {
    return this.collapsed.has(repoPath);
  }

  /** Fold a project down to its heading, or open it (`collapse` unset: the
   *  other way from now). Saved, once the saved folds have been read. */
  toggleCollapsed(repoPath: string, collapse = !this.collapsed.has(repoPath)): void {
    if (collapse === this.collapsed.has(repoPath)) return;
    const next = new Set(this.collapsed);
    if (collapse) next.add(repoPath);
    else next.delete(repoPath);
    this.collapsed = next;
    // Saving now would replace the saved list with only this fold.
    if (this.collapsedLoad && !this.collapsedReady) {
      this.foldsWhileLoading.set(repoPath, collapse);
      return;
    }
    this.saveCollapsed();
  }

  /** The folds, less projects with no follow-ups (the drawer doesn't list
   *  those), so a project removed while folded isn't kept for good. */
  private saveCollapsed(): void {
    const kept = this.ready ? [...this.collapsed].filter((p) => this.list.some((f) => f.repoPath === p)) : [...this.collapsed];
    window.groveBench.setCollapsedFollowUpProjects(kept);
  }

  /** Once both the folds and the follow-ups are read: drop and save away
   *  folds of projects that have no follow-ups left. */
  private pruneCollapsed(): void {
    if (!this.collapsedReady || !this.ready) return;
    const kept = [...this.collapsed].filter((p) => this.list.some((f) => f.repoPath === p));
    if (kept.length === this.collapsed.size) return;
    this.collapsed = new Set(kept);
    this.saveCollapsed();
  }

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    void this.loadCollapsed();
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
          this.pruneCollapsed();
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
    return this.list.filter((f) => isFollowUpOpen(f) && projects.has(f.repoPath)).length;
  }

  /** Each project with follow-ups: open ones highest priority first, oldest
   *  first inside each (the order they came up), done and closed ones most
   *  recent first. Projects in `repoOrder` first, in that order, then any
   *  others (a removed project's). */
  byProject(repoOrder: readonly string[]): FollowUpProject[] {
    const projects = new Map<string, FollowUpProject>();
    for (const f of this.list) {
      let p = projects.get(f.repoPath);
      if (!p) projects.set(f.repoPath, p = { repoPath: f.repoPath, open: [], ended: [] });
      (isFollowUpOpen(f) ? p.open : p.ended).push(f);
    }
    for (const p of projects.values()) {
      p.open = byFollowUpPriority(p.open);
      p.ended.sort((a, b) => (followUpEndedAt(b) ?? 0) - (followUpEndedAt(a) ?? 0));
    }
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

  /** Open the drawer at one follow-up: its card in full with its details,
   *  its project open, and its project's done and closed ones shown when it
   *  is one of them, so it is on screen. */
  reveal(id: string): void {
    const f = this.get(id);
    if (!f) return;
    this.expanded = new Set([...this.expanded, id]);
    this.foldRevealed();
    if (!this.unfolded.has(id)) {
      this.unfolded = new Set([...this.unfolded, id]);
      this.revealUnfolded = id;
    }
    this.toggleCollapsed(f.repoPath, false);
    if (!isFollowUpOpen(f)) this.showEnded = new Set([...this.showEnded, f.repoPath]);
    this.notice = null;
    this.revealId = id;
    this.revealCount++;
    this.toggleDrawer(true);
  }

  /** Done (true), or open again (false) whether it was done or closed. */
  setDone(id: string, done: boolean): Promise<void> {
    return window.groveBench.setFollowUpDone(id, done);
  }

  /** Closed without being done. setDone(id, false) opens it again. */
  close(id: string): Promise<void> {
    return window.groveBench.closeFollowUp(id);
  }

  setPriority(id: string, priority: FollowUpPriority): Promise<void> {
    return window.groveBench.setFollowUpPriority(id, priority);
  }

  remove(id: string): Promise<void> {
    return window.groveBench.removeFollowUp(id);
  }

  /** Add one by hand (FollowUpForm). Resolves with what main kept: an open
   *  one with the same title instead, when there is one (`existing`). The
   *  list shows it at once, without waiting for main's change. */
  async add(repoPath: string, title: string, details: string, priority?: FollowUpPriority): Promise<{ followUp: FollowUp; existing: boolean }> {
    const result = await window.groveBench.addFollowUp(repoPath, title, details, priority);
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
    return this.list.filter((f) => f.repoPath === repoPath && isFollowUpOpen(f)).length;
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
      this.foldRevealed();
    }
  }

  /** Show an in-progress follow-up in full, or on two lines again. Yours
   *  to keep: closing the drawer doesn't undo it. */
  toggleUnfolded(id: string): void {
    if (this.revealUnfolded === id) this.revealUnfolded = null;
    const next = new Set(this.unfolded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.unfolded = next;
  }

  /** Back to two lines: the in-progress follow-up the last reveal showed
   *  in full, if it did that and you haven't since. */
  private foldRevealed(): void {
    const id = this.revealUnfolded;
    this.revealUnfolded = null;
    if (!id || !this.unfolded.has(id)) return;
    const next = new Set(this.unfolded);
    next.delete(id);
    this.unfolded = next;
  }
}

export const followUpsStore = new FollowUpsStore();
