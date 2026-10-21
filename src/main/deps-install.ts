import { spawnProcess, type HostedProcess } from './process-host.js';
import { killTree } from './process-tree.js';
import { logger } from './logger.js';

/**
 * `npm install` in a new worktree, with the project's shared cache.
 *
 * It starts in the agent host (spawnProcess), so the launch (cmd.exe running
 * npm's .cmd shim) never holds up the window. That host, unlike the one git
 * runs in, isn't restarted when a command goes unanswered, so a long install
 * isn't stopped by someone else's hung command.
 *
 * Aborting kills the whole install tree, not just the child: on Windows npm
 * runs under cmd.exe, and killing only that would leave npm's node process
 * holding files in a worktree that is about to be removed. Rejects with the
 * signal's reason when aborted.
 */
export async function installDependencies(cwd: string, npmCache: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const args = ['install', '--prefer-offline', '--cache', npmCache];
  // findCommand: find npm's .cmd shim on PATH and run it through cmd.exe,
  // its arguments escaped, as execa does.
  const install = spawnProcess('npm', args, { cwd, findCommand: true });
  const stop = () => {
    if (install.pid === undefined) return;
    killTree(install.pid).catch((e) => logger.warn(`Failed to stop npm install in ${cwd}:`, e));
  };
  const onAbort = () => {
    // Not started yet (the host hasn't said): kill it once it has.
    if (install.pid === undefined) install.once('spawn', stop);
    else stop();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await finished(install, `npm ${args.join(' ')}`);
  } catch (e) {
    // Killed because of the abort: report the cancel, not the kill.
    signal.throwIfAborted();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
    install.off('spawn', stop);
  }
}

/**
 * Wait for a spawned command to end. Resolves when it exits with 0;
 * otherwise rejects as execa did, with `exitCode` and what it wrote to
 * stderr (which the caller shows), or with the error that kept it from
 * starting (`code` ENOENT when npm isn't installed).
 */
function finished(proc: HostedProcess, command: string): Promise<void> {
  // Unread, its output would pile up here for as long as it runs.
  proc.stdout.resume();
  let stderr = '';
  proc.stderr.on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    let startError: Error | undefined;
    proc.on('error', (e: Error) => { startError ??= e; });
    proc.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (startError) {
        reject(startError);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const how = code === null ? `was killed${signal ? ` with ${signal}` : ''}` : `failed with exit code ${code}`;
      const output = stderr.trim();
      reject(Object.assign(new Error(`Command ${how}: ${command}${output ? `\n\n${output}` : ''}`), {
        ...(code !== null ? { exitCode: code } : {}),
        ...(signal ? { signal } : {}),
        stderr: output,
      }));
    });
  });
}
