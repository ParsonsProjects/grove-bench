import type { SessionStatus } from '../../shared/types.js';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';

type Thread = { id: string; status: SessionStatus };

/** Whether a background agent is still running for the thread. Only while
 *  its agent is up: closing it or letting it sleep shuts the agent down, and
 *  its background agents with it, though their tasks stay listed until it
 *  starts again (main then sends an empty task list). */
export function backgroundAgentRunning(thread: Thread): boolean {
  return thread.status === 'running' && backgroundTaskStore.hasRunningAgent(thread.id);
}

/** Whether a thread is in the middle of a turn or has a background agent
 *  running. Closing it, restarting to update, or rewriting its checkout
 *  would cut that work off, so they ask or wait first. Starting up and
 *  installing show blue too, but aren't counted here. */
export function threadWorking(sessionId: string): boolean {
  if (messageStore.getIsRunning(sessionId)) return true;
  const thread = store.sessions.find((s) => s.id === sessionId);
  return !!thread && backgroundAgentRunning(thread);
}
