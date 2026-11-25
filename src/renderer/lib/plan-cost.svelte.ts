import { usageStore } from '../stores/usage.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { store } from '../stores/sessions.svelte.js';

/**
 * Whether a thread's turns count toward a plan (Pro, Max, ...) rather than
 * being billed. On a plan the SDK's dollar figure is list price that isn't
 * billed, so it is left out: https://code.claude.com/docs/en/costs. The
 * answer comes from plan usage (reported means a plan), so null while that
 * isn't known yet. An agent that can't report usage can't say, so its cost
 * shows. Reads stores: call it inside $derived to follow them.
 */
export function coveredByPlan(sessionId: string): boolean | null {
  const usage = usageStore.get(usageStore.providerFor(sessionId));
  if (usage) return usage.available;
  if (!agentsStore.loaded) return null;
  const agentType = store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId;
  return agentsStore.get(agentType)?.capabilities.usage === true ? null : false;
}
