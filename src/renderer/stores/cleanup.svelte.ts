/**
 * A Clean Up Old Threads run, and how the last one went. Kept here rather
 * than in the dialog, so removal carries on when the dialog is closed, the
 * sidebar's clean-up button can show it, the dialog can show its progress
 * when opened again, and CleanupToast (in App's toast stack) can say how it
 * went.
 */

/** `skipped`: opened again while the run waited to reach it, so left alone
 *  (the dialog can be closed mid-run, and the thread finder still opens it). */
type CleanupItemState = 'waiting' | 'removing' | 'done' | 'failed' | 'skipped';

interface CleanupItem {
  id: string;
  /** The thread's name, as its row in the dialog shows it. */
  label: string;
  project: string;
  state: CleanupItemState;
  error?: string;
}

interface CleanupResult {
  removed: number;
  failed: Array<{ label: string; error: string }>;
  /** Labels of the threads left alone because they were opened again. */
  skipped: string[];
}

class CleanupStore {
  /** The run under way, or null. */
  run = $state<{ items: CleanupItem[] } | null>(null);
  /** How the last run went, until its toast is dismissed or times out. */
  result = $state<CleanupResult | null>(null);

  readonly running = $derived(this.run !== null);
  readonly total = $derived(this.run?.items.length ?? 0);
  /** Threads the run has finished with: removed, failed or left alone. */
  readonly settled = $derived(this.run?.items.filter((i) => i.state !== 'waiting' && i.state !== 'removing').length ?? 0);

  /** Start a run over these threads, all waiting. Replaces the last result. */
  start(items: Array<Omit<CleanupItem, 'state' | 'error'>>): CleanupItem[] {
    this.result = null;
    this.run = { items: items.map((i) => ({ ...i, state: 'waiting' as const })) };
    return this.run.items;
  }

  /** End the run and keep how it went, for the toast. */
  finish(): void {
    const items = this.run?.items ?? [];
    this.result = {
      removed: items.filter((i) => i.state === 'done').length,
      failed: items.filter((i) => i.state === 'failed').map((i) => ({ label: i.label, error: i.error ?? 'Unknown error' })),
      skipped: items.filter((i) => i.state === 'skipped').map((i) => i.label),
    };
    this.run = null;
  }
}

export const cleanupStore = new CleanupStore();
