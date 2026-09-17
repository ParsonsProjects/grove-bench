import type { ReviewComment } from '../lib/diff-types.js';

/** Per-session review state for the Changes tab: which files the user has
 *  marked viewed (keyed by the content hash they saw, so a later edit shows
 *  as "changed since viewed"), and draft line comments waiting to be sent to
 *  the agent as one prompt. Persisted in localStorage so a reload keeps it. */
interface SessionReview {
  viewed: Record<string, string>;
  comments: ReviewComment[];
}

const STORAGE_PREFIX = 'grove-bench:review:';

function load(sessionId: string): SessionReview {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sessionId);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionReview>;
      return { viewed: parsed.viewed ?? {}, comments: parsed.comments ?? [] };
    }
  } catch { /* storage unavailable or corrupt — start clean */ }
  return { viewed: {}, comments: [] };
}

function persist(sessionId: string, review: SessionReview): void {
  try {
    if (Object.keys(review.viewed).length === 0 && review.comments.length === 0) {
      localStorage.removeItem(STORAGE_PREFIX + sessionId);
    } else {
      localStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(review));
    }
  } catch { /* best-effort */ }
}

let nextCommentId = 1;

class ReviewStore {
  bySession = $state<Record<string, SessionReview>>({});
  /** Sessions read from storage but not yet written to. Kept outside the
   *  reactive record so a read from inside a $derived never mutates state. */
  private loaded = new Map<string, SessionReview>();

  private get(sessionId: string): SessionReview {
    const live = this.bySession[sessionId];
    if (live) return live;
    let r = this.loaded.get(sessionId);
    if (!r) {
      r = load(sessionId);
      this.loaded.set(sessionId, r);
    }
    return r;
  }

  private set(sessionId: string, review: SessionReview): void {
    this.loaded.set(sessionId, review);
    this.bySession = { ...this.bySession, [sessionId]: review };
    persist(sessionId, review);
  }

  // ── Viewed ──
  // A file is stored with the content hash the user saw. Hashes are best-effort
  // (the main process may skip them for huge change sets or a transient git
  // failure), so an unknown hash never flips a verdict: a viewed file stays
  // viewed, and a file marked viewed without a hash matches any later content.

  private static ANY = '*';

  /** True when the file was marked viewed at its current content. */
  isViewed(sessionId: string, filePath: string, contentHash: string | undefined): boolean {
    const stored = this.get(sessionId).viewed[filePath];
    if (stored === undefined) return false;
    if (stored === ReviewStore.ANY || contentHash === undefined) return true;
    return stored === contentHash;
  }

  /** True when the file was marked viewed but its content changed since. */
  changedSinceViewed(sessionId: string, filePath: string, contentHash: string | undefined): boolean {
    const stored = this.get(sessionId).viewed[filePath];
    if (stored === undefined || stored === ReviewStore.ANY || contentHash === undefined) return false;
    return stored !== contentHash;
  }

  setViewed(sessionId: string, filePath: string, contentHash: string | undefined, viewed: boolean): void {
    const r = this.get(sessionId);
    const next = { ...r.viewed };
    if (viewed) next[filePath] = contentHash ?? ReviewStore.ANY;
    else delete next[filePath];
    this.set(sessionId, { ...r, viewed: next });
  }

  viewedCount(sessionId: string, files: { filePath: string; contentHash?: string }[]): number {
    return files.filter(f => this.isViewed(sessionId, f.filePath, f.contentHash)).length;
  }

  // ── Line comments ──

  getComments(sessionId: string): ReviewComment[] {
    return this.get(sessionId).comments;
  }

  addComment(sessionId: string, comment: Omit<ReviewComment, 'id' | 'createdAt'>): ReviewComment {
    const r = this.get(sessionId);
    const full: ReviewComment = { ...comment, id: `rc-${Date.now()}-${nextCommentId++}`, createdAt: Date.now() };
    this.set(sessionId, { ...r, comments: [...r.comments, full] });
    return full;
  }

  updateComment(sessionId: string, id: string, body: string): void {
    const r = this.get(sessionId);
    this.set(sessionId, { ...r, comments: r.comments.map(c => (c.id === id ? { ...c, body } : c)) });
  }

  removeComment(sessionId: string, id: string): void {
    const r = this.get(sessionId);
    this.set(sessionId, { ...r, comments: r.comments.filter(c => c.id !== id) });
  }

  clearComments(sessionId: string): void {
    const r = this.get(sessionId);
    this.set(sessionId, { ...r, comments: [] });
  }

  clear(sessionId: string): void {
    this.loaded.delete(sessionId);
    const { [sessionId]: _drop, ...rest } = this.bySession;
    this.bySession = rest;
    try { localStorage.removeItem(STORAGE_PREFIX + sessionId); } catch { /* ignore */ }
  }
}

export const reviewStore = new ReviewStore();
