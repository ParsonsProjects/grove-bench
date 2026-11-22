/**
 * Queued messages kept in localStorage, one entry per thread, so a reload,
 * a crash or a restart doesn't lose what the user lined up. A queue that
 * comes back starts paused (see messages.svelte.ts): it waits for Resume
 * rather than firing at a thread the user hasn't looked at yet.
 *
 * Attachments are kept once: a message's images and files are made from its
 * typed attachments (as the message box made them), so only those are
 * saved. A queue too big for localStorage stays in memory only: its saved
 * copy is removed, so a restart can't bring back messages sent since.
 */
import type { QueuedMessage } from '../stores/messages.svelte.js';
import { attachmentPayload } from './file-attachments.js';

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

/** Whether a message's images and files come from its typed attachments. */
function madeFromTyped(item: QueuedMessage): boolean {
  return item.typed?.attachments.some((a) => a.type !== 'text') ?? false;
}

/** The message as saved: without the images and files its typed
 *  attachments make. */
function forSaving(item: QueuedMessage): QueuedMessage {
  if (!madeFromTyped(item)) return item;
  const { images: _images, files: _files, ...rest } = item;
  return rest;
}

/** A saved message as the queue holds it, its images and files made again. */
function fromSaved(item: QueuedMessage): QueuedMessage {
  if (item.images || item.files || !madeFromTyped(item)) return item;
  const { images, files } = attachmentPayload(item.typed!.attachments);
  return { ...item, ...(images.length > 0 ? { images } : {}), ...(files.length > 0 ? { files } : {}) };
}

/** Save a thread's queue, or forget it when it is empty. */
export function saveQueue(sessionId: string, items: QueuedMessage[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (items.length === 0) store.removeItem(PREFIX + sessionId);
    else store.setItem(PREFIX + sessionId, JSON.stringify({ v: VERSION, items: items.map(forSaving) } satisfies SavedQueue));
  } catch (e) {
    // The copy saved before would come back after a restart, holding
    // messages sent since: better none.
    try { store.removeItem(PREFIX + sessionId); } catch { /* nothing more to do */ }
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
      const items = saved.items.filter(isQueuedMessage).map(fromSaved);
      if (items.length > 0) out[key.slice(PREFIX.length)] = items;
    } catch {
      // A damaged entry is skipped; the next save replaces it.
    }
  }
  return out;
}
