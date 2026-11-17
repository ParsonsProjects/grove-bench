/**
 * Threads flagged To do: ones you mean to come back to. The unread flag goes
 * as soon as a thread is opened; a To do flag stays until you clear it, so a
 * follow-up isn't lost once you've looked at the thread. Any thread can carry
 * one, whatever its status. Saved through main in app-state.json.
 *
 * A To do can also say why (a note) and when (one optional date, with an
 * optional time that sets an alert). PROTOTYPE: those details are kept in
 * localStorage for now; they move into app-state.json beside the flags once
 * the design is settled.
 */
import { isDue, type DueDate } from '../lib/todo-due.js';
import { sessionLabel } from '../lib/os-notify.js';

/** How often, and how many times, to ask again while app-state.json can't be
 *  read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

const DETAILS_KEY = 'grove-bench:todo-details';

/** Longest note. */
export const MAX_TODO_NOTE_LENGTH = 500;

/** An alert this late is one the app missed (closed, or the PC asleep): the
 *  To do just shows as due, with no late notification. */
const ALERT_GRACE_MS = 5 * 60 * 1000;

export interface TodoDetails {
  /** What to come back for. */
  note?: string;
  due?: DueDate;
  /** The alert for `due` went off, or was missed. */
  alerted?: boolean;
}

/** A To do whose alert went off while the app was open, for the toast. */
export interface TodoAlert {
  sessionId: string;
  note: string;
}

function loadDetails(): Record<string, TodoDetails> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(DETAILS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, TodoDetails> : {};
  } catch {
    return {};
  }
}

function hasContent(d: TodoDetails): boolean {
  return !!d.note || !!d.due;
}

class TodoStore {
  /** Flagged thread ids, oldest first. Ids of threads that didn't load this
   *  run (their project folder is missing) stay, so the flag is still there
   *  when they come back. */
  ids = $state<string[]>([]);
  /** The saved flags have been read. Until then nothing is saved, so a list
   *  that failed to load can't be written over the real one, and the menu
   *  doesn't offer To do. */
  ready = $state(false);

  /** Notes and dates, by thread. A flag can have none. */
  details = $state<Record<string, TodoDetails>>(loadDetails());

  /** The To do popup, open by a thread at a point on screen (the menu's
   *  pointer, or the button that opened it). */
  editing = $state<{ sessionId: string; x: number; y: number } | null>(null);

  /** The alert showing in the app, if any. */
  alert = $state<TodoAlert | null>(null);

  /** Moved on by tick(), so due marks change without a reload. */
  now = $state(Date.now());

  // Every sidebar row looks itself up.
  private idSet = $derived(new Set(this.ids));

  /** Flagged threads whose date has come. */
  dueCount = $derived(this.ids.filter((id) => isDue(this.details[id]?.due, this.now)).length);

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
    if (!on && this.ready) this.setDetails(sessionId, {});
  }

  getDetails(sessionId: string): TodoDetails {
    return this.details[sessionId] ?? {};
  }

  /** Replace a To do's note and date. A new date sets a new alert. */
  setDetails(sessionId: string, next: TodoDetails): void {
    const prev = this.details[sessionId];
    const rest = { ...this.details };
    delete rest[sessionId];
    if (hasContent(next)) {
      const sameDue = prev?.due?.at === next.due?.at && prev?.due?.timed === next.due?.timed;
      rest[sessionId] = { ...next, alerted: sameDue ? prev?.alerted : undefined };
    }
    this.details = rest;
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify(rest)); } catch { /* prototype */ }
  }

  /** Whether the thread is flagged and its date has come. */
  isDue(sessionId: string): boolean {
    return this.has(sessionId) && isDue(this.details[sessionId]?.due, this.now);
  }

  /** Flag the thread (if it isn't) and open the popup for its note and date. */
  openEditor(sessionId: string, x: number, y: number): void {
    if (!this.ready) return;
    this.set(sessionId, true);
    this.editing = { sessionId, x, y };
  }

  closeEditor(): void {
    this.editing = null;
  }

  /** Move the clock on and set off alerts that came due. One missed by more
   *  than a few minutes is only marked, so it shows as due without a late
   *  notification. */
  tick(now: number): void {
    this.now = now;
    for (const id of this.ids) {
      const d = this.details[id];
      if (!d?.due?.timed || d.alerted || now < d.due.at) continue;
      this.details = { ...this.details, [id]: { ...d, alerted: true } };
      try { localStorage.setItem(DETAILS_KEY, JSON.stringify(this.details)); } catch { /* prototype */ }
      if (now - d.due.at > ALERT_GRACE_MS) continue;
      const note = d.note ?? '';
      this.alert = { sessionId: id, note };
      try {
        window.groveBench.notify({ kind: 'todo_due', sessionId: id, title: sessionLabel(id), body: note ? `To do: ${note}` : 'To do is due' });
      } catch { /* notifications are best-effort */ }
    }
  }

  dismissAlert(): void {
    this.alert = null;
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
