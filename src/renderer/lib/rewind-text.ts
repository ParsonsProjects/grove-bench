/** How a rewind is described wherever it asks first (the rewind dialog, the
 *  Checkpoints tab), so the warnings say the same thing. */

/** What a restore does to the files: the whole worktree goes back (git
 *  restore, then git clean), after a copy of it is kept, which the thread
 *  offers back (CheckpointManager.restoreKept, FilesKeptBlock). */
export const FILES_REPLACED = 'your own changes go too, and new files are removed, but the thread keeps a copy of them as they are now, so you can bring them back';

/** An agent that can't fork its conversation at a point starts over. */
export function startsAfresh(agentName: string): string {
  return `${agentName} can't forget part of a thread, so it starts afresh from there: it won't remember the earlier turns either.`;
}
