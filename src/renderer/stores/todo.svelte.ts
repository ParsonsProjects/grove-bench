/**
 * Threads flagged To do: ones you mean to come back to. The unread flag goes
 * as soon as a thread is opened; a To do flag stays until you clear it, so a
 * follow-up isn't lost once you've looked at the thread. Any thread can carry
 * one, whatever its status. Saved through main in app-state.json.
 */

/** How often, and how many times, to ask again while app-state.json can't be
 *  read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

class TodoStore {
  /** Flagged thread ids, oldest first. Ids of threads that didn't load this
   *  run (their project folder is missing) stay, so the flag is still there
   *  when they come back. */
  ids = $state<string[]>([]);
  /** The saved flags have been read. Until then nothing is saved, so a list
   *  that failed to load can't be written over the real one, and the menu
   *  doesn't offer To do. */
  ready = $state(false);

  // Every sidebar row looks itself up.
  private idSet = $derived(new Set(this.ids));

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const ids = await window.groveBench.getTodoSessions();
        if (ids) {
          this.ids = ids;
          this.ready = true;
          return;
        }
      } catch (e) {
        console.warn('[todo] could not load the To do flags:', e);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    console.warn('[todo] app-state.json stayed unreadable; To do is off until the next launch');
  }

  has(sessionId: string): boolean {
    return this.idSet.has(sessionId);
  }

  set(sessionId: string, on: boolean): void {
    if (on === this.has(sessionId)) return;
    this.save(on ? [...this.ids, sessionId] : this.ids.filter((id) => id !== sessionId));
  }

  /** Drop the flag of a thread that was deleted. */
  forget(sessionId: string): void {
    this.set(sessionId, false);
  }

  /** Apply and save a change. Refused until the saved flags have been read. */
  private save(next: string[]): void {
    if (!this.ready) return;
    this.ids = next;
    window.groveBench.setTodoSessions([...next]);
  }
}

export const todoStore = new TodoStore();
