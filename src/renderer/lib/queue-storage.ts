/**
 * Queued messages kept in localStorage, one entry per thread, so a reload,
 * a crash or a restart doesn't lose what the user lined up. A queue that
 * comes back starts paused (see messages.svelte.ts): it waits for Resume
 * rather than firing at a thread the user hasn't looked at yet.
 *
 * Images are kept inline (base64), as the queue holds them. A queue too big
 * for localStorage stays in memory only, and the failure is logged.
 */
import type { QueuedMessage } from '../stores/messages.svelte.js';

const PREFIX = 'grove-bench:queue:';
const VERSION = 1;

interface SavedQueue {
  v: number;
  items: QueuedMessage[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Access can throw where storage is turned off.
    return null;
  }
}

/** Save a thread's queue, or forget it when it is empty. */
export function saveQueue(sessionId: string, items: QueuedMessage[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (items.length === 0) store.removeItem(PREFIX + sessionId);
    else store.setItem(PREFIX + sessionId, JSON.stringify({ v: VERSION, items } satisfies SavedQueue));
  } catch (e) {
    console.warn(`[queue] couldn't save the queue for ${sessionId}, so it is kept in memory only:`, e);
  }
}

export function forgetQueue(sessionId: string): void {
  try {
    storage()?.removeItem(PREFIX + sessionId);
  } catch {
    // Nothing to forget.
  }
}

function isQueuedMessage(value: unknown): value is QueuedMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.displayText === 'string' && typeof m.outgoing === 'string';
}

/** Every saved queue, by thread. Entries that don't parse are dropped. */
export function loadQueues(): Record<string, QueuedMessage[]> {
  const store = storage();
  const out: Record<string, QueuedMessage[]> = {};
  if (!store) return out;
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const saved = JSON.parse(store.getItem(key) ?? '') as Partial<SavedQueue>;
      if (saved.v !== VERSION || !Array.isArray(saved.items)) continue;
      const items = saved.items.filter(isQueuedMessage);
      if (items.length > 0) out[key.slice(PREFIX.length)] = items;
    } catch {
      // A damaged entry is skipped; the next save replaces it.
    }
  }
  return out;
}
