import { agentsStore } from '../stores/agents.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { AgentSummary } from '../../shared/types.js';

/** The agent a thread runs on, once the agent list has loaded. */
function threadAgent(sessionId: string): AgentSummary | undefined {
  return agentsStore.get(store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId);
}

/** Whether a thread's agent can summarise the thread to free context
 *  (/compact): it says so (capabilities.compact), or lists the command. */
export function canCompact(sessionId: string): boolean {
  return threadAgent(sessionId)?.capabilities.compact === true
    || messageStore.getSystemInfo(sessionId).slashCommands.includes('compact');
}

/** Whether a thread's agent can forget the turns after a rewind point and
 *  carry on from there. Without it, a rewind starts the agent afresh. True
 *  until the agent list loads, as the rewind itself still works. */
export function canRewindThread(sessionId: string): boolean {
  return threadAgent(sessionId)?.capabilities.rewind !== false;
}
