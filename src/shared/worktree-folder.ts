/**
 * Settings > Git's worktree folder: where new worktrees go instead of the
 * app's data folder, on a Dev Drive say. Empty means the data folder.
 */

/**
 * Longer than this and a worktree's paths get longer than they are in the
 * default folder, `C:\Users\<name>\AppData\Roaming\grove-bench\worktrees`
 * (47 characters plus the user name). Git and many build tools on Windows
 * still stop at 260 characters (MAX_PATH), and a deep node_modules gets close.
 */
export const WORKTREE_FOLDER_MAX_LENGTH = 60;

/** A full path: a drive (`D:\`) or a network share (`\\server\share`), or off
 *  Windows one from `/`. Anything else depends on where Grove started: on
 *  Windows `/wt` is the root of whichever drive that was. */
function isFullPath(folder: string, windows: boolean): boolean {
  return /^[a-zA-Z]:[\\/]/.test(folder) || /^\\\\[^\\]+\\[^\\]+/.test(folder) || (!windows && folder.startsWith('/'));
}

/** Why new worktrees can't go in `folder`, or null when they can. `windows`:
 *  where the path is used (Settings only runs there; tests run elsewhere). */
export function worktreeFolderError(folder: string, windows = true): string | null {
  const trimmed = folder.trim();
  if (!trimmed) return null;
  if (!isFullPath(trimmed, windows)) return 'Use a full path, such as D:\\worktrees.';
  return null;
}

/** A usable folder whose worktree paths may get too long for Windows tools. */
export function worktreeFolderTooLong(folder: string): boolean {
  return folder.trim().length > WORKTREE_FOLDER_MAX_LENGTH;
}
