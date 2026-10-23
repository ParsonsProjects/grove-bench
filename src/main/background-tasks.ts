import { adapterRegistry } from './adapters/index.js';
import { isClaudeAccountId, removedAccountMessage } from './adapters/claude-accounts.js';
import type { AgentAdapter } from './adapters/types.js';
import type { WorktreeInfo } from '../shared/types.js';
import { getSettings } from './settings.js';
import { worktreeManager } from './worktree-manager.js';

/**
 * Which agent and model run background tasks: memory notes and compaction,
 * commit messages and skill suggestions. Each task runs on the agent of the
 * conversation it belongs to, so a conversation's content only goes to the
 * provider the user chose for it, and uses that agent's cheap background
 * model rather than its conversation model. After a switch to another agent
 * the tasks read only what came after it (agent-handoff.ts).
 */

/** The user's pick in Settings > Agents, else the adapter's own cheap default,
 *  else undefined (the agent's default model). */
export function backgroundModelFor(adapter: AgentAdapter): string | undefined {
  return getSettings().backgroundModels?.[adapter.id] || adapter.backgroundModel || undefined;
}

/** The agent for background work on a conversation recorded as running on
 *  `adapterType`: that agent, or the default one for a conversation that
 *  recorded none. Null when that agent is gone (a custom agent taken out of
 *  Settings, a removed Claude account): its content must not go to another
 *  provider unless the user says so (recordedAgent's `substitute`). */
export function backgroundAgentFor(adapterType: string | null | undefined): AgentAdapter | null {
  if (!adapterType) return adapterRegistry.getDefault();
  return adapterRegistry.get(adapterType) ?? null;
}

/** Why a background task didn't run: the conversation's agent is gone and
 *  the user picked no other. */
export function agentGoneMessage(adapterType: string): string {
  return isClaudeAccountId(adapterType)
    ? removedAccountMessage(adapterType)
    : `This thread's agent ("${adapterType}") isn't available any more. Pick another agent to run this on.`;
}

/** The agent a conversation ran on, from the manifest, for a conversation
 *  that isn't running (backgroundAgentFor). When that agent is gone,
 *  `substitute` is the agent the user picked to run the task on instead (the
 *  renderer asks: backgroundAgentStore); without one this throws. */
export async function recordedAgent(sessionId: string, substitute?: string): Promise<AgentAdapter> {
  const id = await worktreeManager.getAdapterType(sessionId);
  const adapter = backgroundAgentFor(id);
  if (adapter) return adapter;
  const picked = substitute ? adapterRegistry.get(substitute) : undefined;
  if (picked) return picked;
  throw new Error(agentGoneMessage(id!));
}

/** The agent of the most recently active conversation in `conversations`
 *  that `accept` allows, or null when there is none. */
export function newestAgent(
  conversations: readonly WorktreeInfo[],
  accept: (adapter: AgentAdapter) => boolean = () => true,
): AgentAdapter | null {
  const newestFirst = [...conversations].sort(
    (a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt),
  );
  for (const conversation of newestFirst) {
    const adapter = conversation.agentType ? adapterRegistry.get(conversation.agentType) : undefined;
    if (adapter && accept(adapter)) return adapter;
  }
  return null;
}

/** The agent of the project's most recently active conversation, for
 *  project-level tasks (manual compaction) that have no single conversation.
 *  Falls back to the default agent for a project with no conversations. */
export async function agentForProject(repoPath: string): Promise<AgentAdapter> {
  return newestAgent(await worktreeManager.list(repoPath)) ?? adapterRegistry.getDefault();
}
