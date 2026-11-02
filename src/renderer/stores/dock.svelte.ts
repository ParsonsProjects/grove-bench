/**
 * The dock: a column on the right of a thread, between its tab bar and its
 * bottom bar (the status bar and message box), where the Focus panel, a
 * subagent's thread and Bookmarks open beside the thread instead of over
 * it. The message box and the thread stay in reach while you read.
 *
 * One column shows one panel: the one opened last. Panels opened before it
 * stay open underneath, scrolled where they were, and show again when it
 * closes. Each panel's store keeps its own `open` flag and the opening it
 * last had (nextOpening), so there is no second record to keep in step.
 * Where each panel docks is SideDock's business.
 */
export type DockPanel = 'focus' | 'subagent' | 'bookmarks';

/** The narrowest a docked panel gets, and the room it always leaves the
 *  thread beside it (px). */
export const DOCK_MIN_WIDTH = 256;
export const DOCK_THREAD_MIN_WIDTH = 320;

let openings = 0;

/** A number that grows with every panel opening. A store keeps the one its
 *  panel got when last opened: the dock shows the panel with the highest,
 *  and a panel takes the keyboard only for an opening it hasn't had yet, not
 *  each time it mounts again (its thread's pane coming back, Bookmarks
 *  moving to the thread you switched to). */
export function nextOpening(): number {
  return ++openings;
}

/** Of the panels open in one dock, the one it shows: the one opened last.
 *  Ties (panels opened without nextOpening, as tests do) go to the first. */
export function lastOpened(present: readonly { panel: DockPanel; opening: number }[]): DockPanel | null {
  let best: { panel: DockPanel; opening: number } | null = null;
  for (const p of present) if (!best || p.opening > best.opening) best = p;
  return best?.panel ?? null;
}

class DockStore {
  /** Widths a panel was dragged to (px), kept until the app restarts. */
  widths = $state<Partial<Record<DockPanel, number>>>({});

  setWidth(panel: DockPanel, px: number): void {
    this.widths = { ...this.widths, [panel]: px };
  }
}

export const dockStore = new DockStore();
