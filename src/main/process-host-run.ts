/**
 * Run a command to the end in the agent host and collect what it printed,
 * as runProcess does in the git host: for the claude CLI's auth, mcp and
 * plugin calls (claude-code.ts), every gh call (gh.ts), and typeperf for
 * the health line (process-memory.ts), which hung once in the git host and
 * got it restarted.
 *
 * Those can run long (a plugin install has no time limit) or hang (`mcp
 * list` health-checks every server, and a server it starts can hold the
 * output pipes once cmd.exe is gone; gh waits on the network, and a process
 * it started can hold its pipes the same way once gh itself is killed). In
 * the git host, any command left unanswered gets the host restarted, which
 * would stop a running install, and a hung `mcp list` or `gh pr view` would
 * get it restarted itself, failing other threads' git commands (on 23 Oct a
 * hung `gh pr` failed two checkpoints' `git add` and a `git commit-tree`
 * that way). The agent host isn't restarted for a hang: the
 * command is a spawned process there (spawnProcess), and its time limit is
 * kept here, killing the whole tree (killTree) rather than just cmd.exe.
 *
 * Main process only: unlike the other process-host-* files, the host
 * never loads this one.
 */
import {
  HOST_STOPPED_MESSAGE, spawnProcess, spawnProcessInHost, type HostedOptions, type HostedProcess, type ProcessResult,
  type SpawnProcessOptions,
} from './process-host.js';
import { killTree } from './process-tree.js';
import { logger } from './logger.js';

/** The execa options runInAgentHost takes, read as execa reads them, and
 *  `findCommand` (SpawnProcessOptions): find `file` on PATH, .exe or .cmd,
 *  as execa does (cross-spawn), for a command run without a shell; and
 *  `hostOnly`: never in the main process. When the agent host isn't up (or
 *  doesn't come up while it is starting), the command fails rather than run
 *  there (spawnProcessInHost), for work that can be skipped, such as the
 *  health line's process list (process-memory.ts). */
export type AgentHostRunOptions = Pick<HostedOptions, 'cwd' | 'env' | 'extendEnv' | 'shell' | 'timeout' | 'idempotent' | 'input'>
  & Pick<SpawnProcessOptions, 'findCommand'> & { hostOnly?: boolean };

/** The longest a command with a `timeout` waits to start; the timeout counts
 *  from then. spawnProcess waits for a starting or restarting agent host
 *  only until that start has failed (RESTART_DELAY_MS, then
 *  HOST_START_TIMEOUT_MS: 12 s at most), then starts the command in the main
 *  process or, host-only, fails to start it, so a host that never comes up
 *  is covered there. This bounds the rest: a start the host doesn't report,
 *  because an antivirus holds the launch (the freeze log saw 21 s for
 *  claude.exe) or the host has stopped answering (it isn't restarted for
 *  that). Such a command is stopped and fails, but not as timed out, which
 *  for gh would read as GitHub being unreachable (isNetworkError). */
export const START_WAIT_MS = 30_000;

/** The process ended because its host died, not by itself. */
class HostLostError extends Error {}

/**
 * Run `file` with `args` like execa, in the agent host (spawnProcess: here
 * when it's down, unless `hostOnly`; after it when it's starting). Resolves
 * with its output, final newline stripped, when it exits with 0; otherwise
 * rejects as execa does, with `exitCode`, `stdout`, `stderr` and
 * `timedOut`. Its `timeout` counts from when it has started (within
 * START_WAIT_MS). Its output isn't counted as an agent's (`agentOutput`).
 * One marked `idempotent` runs once more if the host dies under it (not at
 * quit).
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

function runOnce(file: string, args: string[], { cwd, env, extendEnv = true, shell, timeout, input, findCommand, hostOnly }: AgentHostRunOptions): Promise<ProcessResult> {
  const command = [file, ...args].join(' ');
  const proc = (hostOnly ? spawnProcessInHost : spawnProcess)(file, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    // A spawn's env is the whole environment: execa adds `env` to this one
    // unless told not to.
    ...(env !== undefined ? { env: extendEnv ? { ...process.env, ...env } : env } : {}),
    ...(shell ? { shell } : {}),
    ...(findCommand ? { findCommand } : {}),
    // Not an agent: the health line's "agent output" leaves it out.
    agentOutput: false,
  });
  noteCommand(proc);
  if (input !== undefined) {
    // Written to its stdin, which then ends, as execa's `input` does. One
    // that exits before reading it all fails the write (EPIPE), which execa
    // ignores too: how it exits says how it went.
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  }
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
    // Its time limit counts from its start, as runProcess's counts from when
    // the git host has it: not while it waits for the agent host to start
    // or restart, which would cut it short. That wait has its own bound.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const started = () => {
      clearTimeout(waitTimer);
      timer = setTimeout(() => {
        stopTree(proc, command);
        reject(failure(`Command timed out after ${timeout} milliseconds`, command, output, { timedOut: true }));
      }, timeout);
    };
    if (timeout) {
      // Started in this process (the agent host down), it already has.
      if (proc.pid !== undefined) started();
      else {
        proc.once('spawn', started);
        waitTimer = setTimeout(() => {
          proc.off('spawn', started);
          // Still waiting for the host, it never starts; started there, it
          // is killed with its tree.
          proc.kill();
          stopTree(proc, command);
          reject(failure(`Command didn't start within ${START_WAIT_MS / 1000} s`, command, output, {}));
        }, START_WAIT_MS);
      }
    }
    // Its output, all of it, once it has closed.
    void Promise.all([closed, ...ended]).then(([[code, signal]]) => {
      clearTimeout(waitTimer);
      clearTimeout(timer);
      if (startError) reject(startError);
      else if (proc.hostDied) reject(new HostLostError(`${HOST_STOPPED_MESSAGE}: ${command}`));
      else if (code === 0) resolve({ stdout: stripFinalNewline(output.stdout), stderr: stripFinalNewline(output.stderr), exitCode: 0, failed: false, timedOut: false, command });
      else if (code !== null) reject(failure(`Command failed with exit code ${code}`, command, output, { exitCode: code }));
      else reject(failure(`Command was killed with ${signal ?? 'a signal'}`, command, output, signal ? { signal } : {}));
    });
  });
}

/** Kill a command that ran out of time (or of time to start), and
 *  everything it started: with a shell, the command itself is cmd.exe's
 *  child. Once the host says it has started, if it hasn't yet. Not once it
 *  has exited: its PID may be another process's by now, so whatever it left
 *  holding the pipes stays. */
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

// ─── The commands' pids, for the health line ───

/** The commands runInAgentHost started that haven't closed, by pid. */
const commandsRunning = new Map<number, HostedProcess>();
/** The pids each recording has seen (recordCommandPids). */
const recordings = new Set<Set<number>>();

/** Keep a command's pid from its start to its close. */
function noteCommand(proc: HostedProcess): void {
  proc.once('spawn', () => {
    const { pid } = proc;
    if (pid === undefined) return;
    commandsRunning.set(pid, proc);
    for (const pids of recordings) pids.add(pid);
    proc.once('close', () => {
      // Unless a later command has its pid by now.
      if (commandsRunning.get(pid) === proc) commandsRunning.delete(pid);
    });
  });
}

/**
 * Record the pids of the commands runInAgentHost runs: those running now,
 * and every one that starts until the function this returns is called,
 * which stops recording and returns them, closed or not. They are the agent
 * host's children (or, when it is down, the main process's) but aren't
 * agents: gh and the git it starts, the claude CLI's calls, typeperf. The
 * health line's process list (process-memory.ts) leaves them out of the
 * agents. Not just those running when it is read: typeperf, which lists the
 * processes, has closed by then.
 */
export function recordCommandPids(): () => ReadonlySet<number> {
  const pids = new Set(commandsRunning.keys());
  recordings.add(pids);
  return () => {
    recordings.delete(pids);
    return pids;
  };
}
