import { adapterRegistry } from './adapters/index.js';
import type { AgentAdapter } from './adapters/types.js';
import type { WorktreeInfo } from '../shared/types.js';
import { getSettings } from './settings.js';
import { worktreeManager } from './worktree-manager.js';

/**
 * Which agent and model run background tasks: memory notes and compaction,
 * commit messages and skill suggestions. Each task runs on the agent of the
 * conversation it belongs to, so a conversation's content only goes to the
 * provider the user chose for it, and uses that agent's cheap background
 * model rather than its conversation model.
 */

/** The user's pick in Settings > Agent, else the adapter's own cheap default,
 *  else undefined (the agent's default model). */
export function backgroundModelFor(adapter: AgentAdapter): string | undefined {
  return getSettings().backgroundModels?.[adapter.id] || adapter.backgroundModel || undefined;
}

/** The agent a conversation ran on, from the manifest, for a conversation
 *  that isn't running. Falls back to the default agent when the recorded one
 *  is unknown or no longer registered. */
export async function recordedAgent(sessionId: string): Promise<AgentAdapter> {
  const id = await worktreeManager.getAdapterType(sessionId);
  return (id && adapterRegistry.get(id)) || adapterRegistry.getDefault();
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
