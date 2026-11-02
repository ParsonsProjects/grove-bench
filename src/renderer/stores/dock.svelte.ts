/**
 * The dock: a column on the right of a thread, between its tab bar and its
 * bottom bar (the status bar and message box), where the Focus panel, a
 * subagent's thread and Bookmarks open beside the thread instead of over
 * it. The message box and the thread stay in reach while you read.
 *
 * One column shows one panel: the one opened last. Panels opened before it
 * stay open underneath, scrolled where they were, and show again when it
 * closes. Where each panel docks is SideDock's business.
 */
export type DockPanel = 'focus' | 'subagent' | 'bookmarks';

/** The narrowest a docked panel gets, and the room it always leaves the
 *  thread beside it (px). */
export const DOCK_MIN_WIDTH = 256;
export const DOCK_THREAD_MIN_WIDTH = 320;

class DockStore {
  /** The open panels, oldest first. */
  private order = $state<DockPanel[]>([]);
  /** Widths a panel was dragged to (px), kept until the app restarts. */
  widths = $state<Partial<Record<DockPanel, number>>>({});

  /** `panel` opened (or opened again): it shows over the others. */
  raise(panel: DockPanel): void {
    this.order = [...this.order.filter((p) => p !== panel), panel];
  }

  drop(panel: DockPanel): void {
    if (this.order.includes(panel)) this.order = this.order.filter((p) => p !== panel);
  }

  /** Of the panels open in one dock, the one it shows: the last opened, else
   *  the first given (a panel opened without `raise`, as tests do). */
  showing(present: readonly DockPanel[]): DockPanel | null {
    let best: DockPanel | null = null;
    let bestAt = -1;
    for (const p of present) {
      const at = this.order.indexOf(p);
      if (best === null || at > bestAt) {
        best = p;
        bestAt = at;
      }
    }
    return best;
  }

  setWidth(panel: DockPanel, px: number): void {
    this.widths = { ...this.widths, [panel]: px };
  }
}

export const dockStore = new DockStore();
