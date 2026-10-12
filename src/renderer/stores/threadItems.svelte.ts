import { touchesThreadItems, type ThreadItems } from '../../shared/thread-items.js';
import type { AgentEvent } from '../../shared/types.js';

/** How long to wait after a live event before asking main again, so a burst
 *  (a turn's screenshots, a to-do update and its result) costs one call. */
export const REFRESH_DELAY_MS = 300;

/**
 * Each thread's to-do list and files (shared/thread-items.ts), for the status
 * bar's Tasks and Files chips. Main builds them from the whole history, so
 * this only keeps the latest answer per thread, and asks again when a live
 * event may have changed it. A thread loads the first time its chips are on
 * screen, not when its hidden pane mounts.
 */
class ThreadItemsStore {
  bySession = $state<Record<string, ThreadItems>>({});
  /** The latest request per thread, so an older answer that lands last is
   *  dropped. A thread is in here from its first load on. */
  private requests = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  get(sessionId: string): ThreadItems | undefined {
    return this.bySession[sessionId];
  }

  /** Load a thread's items unless that was done already. */
  ensure(sessionId: string): void {
    if (!this.requests.has(sessionId)) void this.load(sessionId);
  }

  async load(sessionId: string): Promise<void> {
    const request = (this.requests.get(sessionId) ?? 0) + 1;
    this.requests.set(sessionId, request);
    try {
      const items = await window.groveBench.getThreadItems(sessionId);
      if (this.requests.get(sessionId) === request) this.bySession[sessionId] = items;
    } catch (err) {
      console.warn(`[threadItems] could not load ${sessionId}:`, err);
    }
  }

  /** A live event arrived: load again shortly if it may change a thread
   *  that has been loaded. */
  noteEvent(sessionId: string, event: AgentEvent): void {
    if (!this.requests.has(sessionId) || !touchesThreadItems(event)) return;
    clearTimeout(this.timers.get(sessionId));
    this.timers.set(sessionId, setTimeout(() => {
      this.timers.delete(sessionId);
      void this.load(sessionId);
    }, REFRESH_DELAY_MS));
  }

  destroy(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
    this.requests.delete(sessionId);
    const { [sessionId]: _drop, ...rest } = this.bySession;
    this.bySession = rest;
  }
}

export const threadItemsStore = new ThreadItemsStore();
