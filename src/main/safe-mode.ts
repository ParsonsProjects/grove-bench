/**
 * Safe mode: Grove Bench started with --safe-mode, to narrow down a launch
 * that freezes. It turns off what the app does on its own around launch and
 * what leans on the graphics driver:
 *
 * - the GPU: the window is drawn in software (app.disableHardwareAcceleration)
 * - cleanup: the worktree sweep (trash, orphaned folders) and deleted
 *   attachments
 * - checks over the network: updates (a manual check still works), the ACP
 *   Registry and models.dev
 *
 * What the user does still works: threads open and their agents start as
 * usual. It lasts until Grove is started without the flag. A second copy
 * started with the flag only hands over to the one running, so it doesn't
 * change that one.
 */
export const SAFE_MODE_FLAG = '--safe-mode';

/** What safe mode turns off, for the startup log and the title bar. */
export const SAFE_MODE_SUMMARY = 'GPU off, no automatic cleanup, no update or catalog checks';

export function isSafeMode(argv: readonly string[] = process.argv): boolean {
  return argv.includes(SAFE_MODE_FLAG);
}

/** This launch's mode, from its command line. */
export const safeMode = isSafeMode();
