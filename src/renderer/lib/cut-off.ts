import type { CutOff } from '../../shared/types.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';

/**
 * The turn a thread had cut off when Grove Bench stopped, still waiting for
 * Continue or Dismiss (shared/cut-off.ts): from its messages once loaded,
 * else from main's preview of its history. None once Continue has queued its
 * prompt, which goes as soon as the agent is ready.
 */
export function threadCutOff(sessionId: string): CutOff | null {
  if (messageStore.hasQueuedContinue(sessionId)) return null;
  if (messageStore.getMessages(sessionId).length > 0) {
    const open = messageStore.openCutOff(sessionId);
    return open ? { reason: open.reason, ...(open.at !== undefined ? { at: open.at } : {}) } : null;
  }
  return sessionPreviewStore.get(sessionId)?.cutOff ?? null;
}
