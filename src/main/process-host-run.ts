/**
 * Run a command to the end in the agent host and collect what it printed,
 * as runProcess does in the git host: for the claude CLI's auth, mcp and
 * plugin calls (claude-code.ts), and typeperf for the health line
 * (process-memory.ts), which hung once in the git host and got it restarted.
 *
 * Those can run long (a plugin install has no time limit) or hang (`mcp
 * list` health-checks every server, and a server it starts can hold the
 * output pipes once cmd.exe is gone). In the git host, any command left
 * unanswered gets the host restarted, which would stop a running install,
 * and a hung `mcp list` would get it restarted itself, failing other
 * threads' git commands. The agent host isn't restarted for a hang: the
 * command is a spawned process there (spawnProcess), and its time limit is
 * kept here, killing the whole tree (killTree) rather than just cmd.exe.
 *
 * Main process only: unlike the other process-host-* files, the host
 * never loads this one.
 */
import {
  HOST_STOPPED_MESSAGE, spawnProcess, spawnProcessInHost, type HostedOptions, type HostedProcess, type ProcessResult,
} from './process-host.js';
import { killTree } from './process-tree.js';
import { logger } from './logger.js';

/** The execa options runInAgentHost takes, read as execa reads them, and
 *  `hostOnly`: never in the main process. When the agent host isn't up (or
 *  doesn't come up while it is starting), the command fails rather than run
 *  there (spawnProcessInHost), for work that can be skipped, such as the
 *  health line's process list (process-memory.ts). */
export type AgentHostRunOptions = Pick<HostedOptions, 'cwd' | 'env' | 'extendEnv' | 'shell' | 'timeout' | 'idempotent'> & { hostOnly?: boolean };

/** The process ended because its host died, not by itself. */
class HostLostError extends Error {}

/**
 * Run `file` with `args` like execa, in the agent host (spawnProcess: here
 * when it's down, unless `hostOnly`; after it when it's starting). Resolves
 * with its output, final newline stripped, when it exits with 0; otherwise
 * rejects as execa does, with `exitCode`, `stdout`, `stderr` and
 * `timedOut`. One marked `idempotent` runs once more if the host dies under
 * it (not at quit).
 */
export async function runInAgentHost(file: string, args: string[], options: AgentHostRunOptions = {}): Promise<ProcessResult> {
  try {
    return await runOnce(file, args, options);
  } catch (e) {
    if (!(e instanceof HostLostError) || !options.idempotent) throw e;
    // By now the host's exit has been handled, so this starts in the host
    // once it has restarted, or here (host-only, it fails instead).
    return runOnce(file, args, options);
  }
}

function runOnce(file: string, args: string[], { cwd, env, extendEnv = true, shell, timeout, hostOnly }: AgentHostRunOptions): Promise<ProcessResult> {
  const command = [file, ...args].join(' ');
  const proc = (hostOnly ? spawnProcessInHost : spawnProcess)(file, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    // A spawn's env is the whole environment: execa adds `env` to this one
    // unless told not to.
    ...(env !== undefined ? { env: extendEnv ? { ...process.env, ...env } : env } : {}),
    ...(shell ? { shell } : {}),
  });
  const output = { stdout: '', stderr: '' };
  const ended = (['stdout', 'stderr'] as const).map((name) => new Promise<void>((resolve) => {
    proc[name].on('data', (chunk: string) => { output[name] += chunk; });
    proc[name].once('end', () => resolve());
  }));
  let startError: Error | undefined;
  proc.on('error', (e: Error) => { startError ??= e; });
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    proc.once('close', (code: number | null, signal: NodeJS.Signals | null) => resolve([code, signal]));
  });
  return new Promise((resolve, reject) => {
    const timer = timeout ? setTimeout(() => {
      stopTree(proc, command);
      reject(failure(`Command timed out after ${timeout} milliseconds`, command, output, { timedOut: true }));
    }, timeout) : undefined;
    // Its output, all of it, once it has closed.
    void Promise.all([closed, ...ended]).then(([[code, signal]]) => {
      clearTimeout(timer);
      if (startError) reject(startError);
      else if (proc.hostDied) reject(new HostLostError(`${HOST_STOPPED_MESSAGE}: ${command}`));
      else if (code === 0) resolve({ stdout: stripFinalNewline(output.stdout), stderr: stripFinalNewline(output.stderr), exitCode: 0, failed: false, timedOut: false, command });
      else if (code !== null) reject(failure(`Command failed with exit code ${code}`, command, output, { exitCode: code }));
      else reject(failure(`Command was killed with ${signal ?? 'a signal'}`, command, output, signal ? { signal } : {}));
    });
  });
}

/** Kill a command that ran out of time, and everything it started: with a
 *  shell, the command itself is cmd.exe's child. Once the host says it has
 *  started, if it hasn't yet. Not once it has exited: its PID may be
 *  another process's by now, so whatever it left holding the pipes stays. */
function stopTree(proc: HostedProcess, command: string): void {
  const kill = () => {
    if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
    killTree(proc.pid).catch((e) => logger.warn(`[process-host] couldn't stop ${command}:`, e));
  };
  if (proc.pid === undefined) proc.once('spawn', kill);
  else kill();
}

/** An error shaped like execa's: what went wrong, then stderr and stdout. */
function failure(prefix: string, command: string, output: { stdout: string; stderr: string }, fields: Partial<ProcessResult>): Error {
  const stdout = stripFinalNewline(output.stdout);
  const stderr = stripFinalNewline(output.stderr);
  const shortMessage = `${prefix}: ${command}`;
  return Object.assign(new Error([shortMessage, stderr, stdout].filter(Boolean).join('\n\n')), {
    shortMessage, command, stdout, stderr, failed: true, timedOut: false, ...fields,
  });
}

/** What execa's stripFinalNewline does: one trailing newline goes. */
function stripFinalNewline(text: string): string {
  return text.replace(/\r?\n$/, '');
}
