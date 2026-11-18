import { messageStore } from '../stores/messages.svelte.js';
import { arrivalScene } from '../stores/arrivalScene.svelte.js';

/**
 * Stop the thread's turn, as the composer's Stop button and the agent
 * monitor's Interrupt do: the agent stops what it is doing but stays up for
 * the next message, and background tasks keep running (main interrupts the
 * query, `SESSION_STOP`).
 */
export function interruptTurn(sessionId: string): void {
  messageStore.markSessionStopped(sessionId, { byUser: true, keepBackground: true });
  // A stopped turn may report no result, so nothing else would end it.
  arrivalScene.end(sessionId);
  void window.groveBench.stopSession(sessionId);
}
