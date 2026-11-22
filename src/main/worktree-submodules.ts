/**
 * Submodules in a new worktree. `git worktree add` checks out the project's
 * files but leaves its submodules as empty folders: "the support for
 * submodules is incomplete" (git-worktree, Bugs). A thread would then start
 * on an incomplete copy, with missing imports and failing builds, and an
 * agent might "fix" those by writing the missing code itself. So when the
 * project has a .gitmodules file, this runs `git submodule update --init`
 * in the worktree, with --recursive for submodules inside submodules
 * (Settings > Git & worktrees chooses, or turns it off).
 *
 * It fetches each submodule from its URL, so it can take a while and may
 * need the network or a sign-in. Like a dependency install it starts in the
 * agent host (spawnProcess), so the launch can't hold up the window, and an
 * abort (the thread deleted during setup) kills the whole tree. There is no
 * terminal prompt (GIT_TERMINAL_PROMPT=0): one nobody can answer would hang
 * it. A credential manager's own sign-in window still shows. It is stopped
 * after SUBMODULE_TIMEOUT_MS all the same.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnProcess } from './process-host.js';
import { finished } from './deps-install.js';
import { logger } from './logger.js';
import type { SubmoduleSetup } from '../shared/types.js';

/** The longest a submodule setup may take before it is stopped. */
export const SUBMODULE_TIMEOUT_MS = 10 * 60_000;

/** Whether the worktree's project lists submodules (a .gitmodules file). */
export async function hasSubmodules(cwd: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(cwd, '.gitmodules'))).isFile();
  } catch {
    return false;
  }
}

/** git's arguments for `mode`: every level ('all') or the top one only. */
export function submoduleArgs(mode: Exclude<SubmoduleSetup, 'off'>): string[] {
  return ['submodule', 'update', '--init', ...(mode === 'all' ? ['--recursive'] : [])];
}

/**
 * Check out the submodules in a new worktree. Rejects with git's error
 * output (`stderr`) when it fails, with a message saying so when it took too
 * long, and with the signal's reason when aborted.
 */
export async function initSubmodules(cwd: string, mode: Exclude<SubmoduleSetup, 'off'>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const args = submoduleArgs(mode);
  // A spawn's env is the whole environment, so it is passed whole.
  // stdout 'ignore': git writes its progress to stderr, kept for the error.
  const proc = spawnProcess('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdout: 'ignore' });
  const kill = () => {
    proc.killTree().catch((e: unknown) => logger.warn(`Failed to stop the submodule setup in ${cwd}:`, e));
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, SUBMODULE_TIMEOUT_MS);
  signal.addEventListener('abort', kill, { once: true });
  try {
    await finished(proc, `git ${args.join(' ')}`);
  } catch (e) {
    // Killed because of the abort: report the cancel, not the kill.
    signal.throwIfAborted();
    if (timedOut) throw new Error(`It took over ${SUBMODULE_TIMEOUT_MS / 60_000} minutes, so it was stopped.`, { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', kill);
  }
}
