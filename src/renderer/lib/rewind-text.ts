/** How a rewind is described wherever it asks first (the rewind dialog, the
 *  Checkpoints tab), so the warnings say the same thing. */

/** What happens to the files a restore replaces: the whole worktree goes
 *  back (git restore, then git clean), after a copy of it is kept, one per
 *  thread (CheckpointManager.restoreKept, FilesKeptBlock). */
export const COPY_KEPT = 'the thread keeps a copy of them as they are now, which you can bring back until the next rewind';

/** An agent that can't fork its conversation at a point starts over. */
export function startsAfresh(agentName: string): string {
  return `${agentName} can't forget part of a thread, so it starts afresh from there: it won't remember the earlier turns either.`;
}
