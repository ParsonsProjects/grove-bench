import { execa } from 'execa';
import { killTree } from './process-tree.js';
import { logger } from './logger.js';

/**
 * `npm install` in a new worktree, with the project's shared cache.
 *
 * Aborting kills the whole install tree, not just the child: on Windows npm
 * runs under cmd.exe, and killing only that would leave npm's node process
 * holding files in a worktree that is about to be removed. Rejects with the
 * signal's reason when aborted.
 */
export async function installDependencies(cwd: string, npmCache: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const install = execa('npm', ['install', '--prefer-offline', '--cache', npmCache], { cwd });
  const onAbort = () => {
    if (!install.pid) return;
    killTree(install.pid).catch((e) => logger.warn(`Failed to stop npm install in ${cwd}:`, e));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await install;
  } catch (e) {
    // Killed because of the abort: report the cancel, not the kill.
    signal.throwIfAborted();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
