import type { SessionPreview } from '../../shared/types.js';

/**
 * Cache of main-process conversation previews (first prompt / last message) for
 * sessions whose messages aren't loaded in the renderer — i.e. stopped sessions.
 * Live sessions derive richer context directly from messageStore; this store is
 * the fallback so sidebar rows and the session finder always have context.
 */
class SessionPreviewStore {
  previews = $state<Record<string, SessionPreview>>({});

  private inFlight = new Set<string>();

  get(sessionId: string): SessionPreview | null {
    return this.previews[sessionId] ?? null;
  }

  /** Fetch previews for any of the given sessions not yet cached (deduped). */
  async ensure(sessionIds: string[]): Promise<void> {
    const missing = sessionIds.filter((id) => !(id in this.previews) && !this.inFlight.has(id));
    if (missing.length === 0) return;
    for (const id of missing) this.inFlight.add(id);
    try {
      const fetched = await window.groveBench.getSessionPreviews(missing);
      // Record every requested id — an id the main process omitted gets an
      // empty preview so it isn't refetched in a loop by reactive callers.
      const merged = { ...this.previews };
      for (const id of missing) merged[id] = fetched[id] ?? { firstPrompt: '', lastText: '' };
      this.previews = merged;
    } catch (e) {
      console.warn('Failed to fetch session previews:', e);
    } finally {
      for (const id of missing) this.inFlight.delete(id);
    }
  }

  /** Drop a cached preview (e.g. when a session stops, so the next fetch is fresh). */
  invalidate(sessionId: string): void {
    if (!(sessionId in this.previews)) return;
    const next = { ...this.previews };
    delete next[sessionId];
    this.previews = next;
  }
}

export const sessionPreviewStore = new SessionPreviewStore();
