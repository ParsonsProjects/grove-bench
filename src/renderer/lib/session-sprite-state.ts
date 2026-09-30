import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentSpriteState, type AgentSpriteState } from './agent-sprite.js';
import { sessionRepoColor } from './session-repo-color.js';

/**
 * The state a conversation's character shows in the sidebar. The wake-up
 * scene uses it too, so the character wears the same colour in both.
 * `destroying` is tracked by the sidebar, which runs the removal.
 */
export function sessionSpriteState(session: { id: string; status: string }, destroying = false): AgentSpriteState {
  return agentSpriteState({
    destroying,
    status: session.status,
    hasPending: messageStore.needsInput(session.id),
    isRunning: messageStore.getIsRunning(session.id),
    needsAttention: !!store.needsAttention[session.id],
  });
}

/**
 * A conversation's agent for a grove scene (`GroveEmptyState`'s `agent`),
 * looking as it does in the sidebar. Null for an unknown conversation.
 */
export function conversationAgent(sessionId: string): { seed: string; state: AgentSpriteState; projectColor: string | null } | null {
  const session = store.sessions.find((s) => s.id === sessionId);
  return session ? { seed: sessionId, state: sessionSpriteState(session), projectColor: sessionRepoColor(sessionId) } : null;
}
