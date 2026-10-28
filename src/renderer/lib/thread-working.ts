import { messageStore } from '../stores/messages.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';

/** Whether a thread is working, as its blue dot says: in the middle of a
 *  turn, or with a background agent still running after one. Closing the
 *  thread or restarting to update stops either, so both ask first. */
export function threadWorking(sessionId: string): boolean {
  return messageStore.getIsRunning(sessionId) || backgroundTaskStore.runningAgents(sessionId).length > 0;
}
