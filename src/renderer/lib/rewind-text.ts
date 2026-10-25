/** How a rewind is described wherever it asks first (the rewind dialog, the
 *  Checkpoints tab), so the warnings say the same thing. */

/** What restoring a checkpoint's files discards: the whole worktree goes
 *  back (git restore, then git clean), and the files as they are now are
 *  kept nowhere. */
export const FILES_LOST = 'every change since is lost, yours included, and new files are deleted';

/** An agent that can't fork its conversation at a point starts over. */
export function startsAfresh(agentName: string): string {
  return `${agentName} can't forget part of a thread, so it starts afresh from there: it won't remember the earlier turns either.`;
}
