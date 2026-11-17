/**
 * A Clean Up Old Threads run, and how the last one went. Kept here rather
 * than in the dialog, so removal carries on when the dialog is closed, the
 * sidebar's clean-up button can show it, the dialog can show its progress
 * when opened again, and CleanupToast (in App's toast stack) can say how it
 * went.
 */

type CleanupItemState = 'waiting' | 'removing' | 'done' | 'failed';

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
}

class CleanupStore {
  /** The run under way, or null. */
  run = $state<{ items: CleanupItem[] } | null>(null);
  /** How the last run went, until its toast is dismissed or times out. */
  result = $state<CleanupResult | null>(null);

  readonly running = $derived(this.run !== null);
  readonly total = $derived(this.run?.items.length ?? 0);
  /** Threads the run has finished with, removed or not. */
  readonly settled = $derived(this.run?.items.filter((i) => i.state === 'done' || i.state === 'failed').length ?? 0);

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
    };
    this.run = null;
  }
}

export const cleanupStore = new CleanupStore();
