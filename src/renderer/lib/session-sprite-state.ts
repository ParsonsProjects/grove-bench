import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentSpriteState, type AgentSpriteState } from './agent-sprite.js';

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
