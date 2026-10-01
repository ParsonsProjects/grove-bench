import type { GitStatusEntry } from '../../shared/types.js';

/** Untracked files Grove writes into worktrees itself for the agent
 *  (AgentAdapter.generatedFiles, via WorktreeManager.generateAdapterSettings).
 *  They aren't the user's work, so losing them with the worktree loses
 *  nothing. This is Claude Code's, used until the agent list has loaded. */
export const DEFAULT_GROVE_WRITTEN: ReadonlySet<string> = new Set(['.claude/settings.local.json']);

/** How many files in a worktree have work that deleting it would lose. A
 *  file that is partly staged has two status entries but counts once.
 *  `groveWritten` lists the files Grove generated (agentsStore.generatedFiles). */
export function unsavedFileCount(entries: readonly GitStatusEntry[], groveWritten: ReadonlySet<string> = DEFAULT_GROVE_WRITTEN): number {
  const files = new Set<string>();
  for (const e of entries) {
    const file = e.filePath.replace(/\\/g, '/');
    if (e.status === 'untracked' && groveWritten.has(file)) continue;
    files.add(file);
  }
  return files.size;
}
