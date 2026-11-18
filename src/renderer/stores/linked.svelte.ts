import type { LinkedProjectStatus } from '../../shared/types.js';

/** How often a watched thread's linked projects are read again, as PR
 *  status is (pr.svelte.ts). */
const POLL_MS = 60_000;

/**
 * The state of each thread's linked projects (git:linkedStatus,
 * docs/linked-projects-plan.md): what the status bar's linked items show.
 * Read when the bar shows the thread, then every minute, at the end of each
 * turn and when the window comes back into focus.
 */
class LinkedStore {
  private bySession = $state<Record<string, LinkedProjectStatus[]>>({});
  /** Reads under way, so a burst of triggers runs one. */
  private inFlight = new Map<string, Promise<void>>();

  get(sessionId: string): LinkedProjectStatus[] {
    return this.bySession[sessionId] ?? [];
  }

  /** Read the thread's linked projects again, PRs and all. A read that
   *  fails keeps what was shown. */
  refresh(sessionId: string): Promise<void> {
    const running = this.inFlight.get(sessionId);
    if (running) return running;
    const read = (async () => {
      try {
        this.bySession[sessionId] = await window.groveBench.getLinkedStatus(sessionId, { pr: true });
      } catch {
        // Kept: the next poll tries again.
      } finally {
        this.inFlight.delete(sessionId);
      }
    })();
    this.inFlight.set(sessionId, read);
    return read;
  }

  /** Keep a thread's linked projects read while something shows them.
   *  Returns the stop, for an $effect. */
  watch(sessionId: string): () => void {
    void this.refresh(sessionId);
    const timer = setInterval(() => void this.refresh(sessionId), POLL_MS);
    const onFocus = () => void this.refresh(sessionId);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }

  /** Drop a deleted thread's state. */
  forget(sessionId: string): void {
    delete this.bySession[sessionId];
  }
}

export const linkedStore = new LinkedStore();
