import type { GitStatusEntry } from '../../shared/types.js';

/** Untracked files Grove writes into every worktree itself
 *  (WorktreeManager.generateAdapterSettings). They aren't the user's work, so
 *  losing them with the worktree loses nothing. */
const GROVE_WRITTEN = new Set(['.claude/settings.local.json']);

/** How many files in a worktree have work that deleting it would lose. A
 *  file that is partly staged has two status entries but counts once. */
export function unsavedFileCount(entries: readonly GitStatusEntry[]): number {
  const files = new Set<string>();
  for (const e of entries) {
    const file = e.filePath.replace(/\\/g, '/');
    if (e.status === 'untracked' && GROVE_WRITTEN.has(file)) continue;
    files.add(file);
  }
  return files.size;
}
