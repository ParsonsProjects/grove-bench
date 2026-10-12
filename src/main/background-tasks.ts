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
 *  `adapterType`: that agent, else the default one (an agent that is gone, or
 *  an older conversation that recorded none). Null for one of the user's
 *  other Claude accounts that has been removed, whose work must not go to a
 *  different account. */
export function backgroundAgentFor(adapterType: string | null | undefined): AgentAdapter | null {
  const adapter = adapterType ? adapterRegistry.get(adapterType) : undefined;
  if (adapter) return adapter;
  return isClaudeAccountId(adapterType) ? null : adapterRegistry.getDefault();
}

/** The agent a conversation ran on, from the manifest, for a conversation
 *  that isn't running (backgroundAgentFor). Throws for a removed account. */
export async function recordedAgent(sessionId: string): Promise<AgentAdapter> {
  const id = await worktreeManager.getAdapterType(sessionId);
  const adapter = backgroundAgentFor(id);
  if (!adapter) throw new Error(removedAccountMessage(id!));
  return adapter;
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
