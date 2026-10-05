/**
 * Process host: git and gh run from an Electron utility process
 * (process-host-child.ts), so starting them never blocks the main process.
 *
 * Starting a process holds whichever process asks for it until the OS has
 * created it. On Windows that is execa's PATH search (cross-spawn stats every
 * PATH folder for every PATHEXT extension) plus CreateProcess, which the
 * freeze log measured at tens of ms per git call, and now and then seconds.
 * While the main process waits, the window can't respond. The host waits
 * instead.
 *
 * Before the app is ready, while the host starts, and once it has failed
 * MAX_FAILURES times in a row, commands run in the main process as they did
 * before. Tests never start it, so their execa mocks see every call.
 *
 * When the host dies with commands in flight, their processes are stopped
 * (their execa timeouts died with the host), read-only ones run again here,
 * and the rest fail: they may have done their work, so they don't run twice.
 * At quit (stop) they all fail.
 */
import { utilityProcess } from 'electron';
import { execa } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeLog, launchLabel } from './freeze-log.js';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';
import {
  HOST_READY, isHostReply, isHostStarted, reviveError,
  type HostedOptions, type HostReply, type HostRequest, type ProcessResult,
} from './process-host-protocol.js';

export type { HostedOptions, ProcessResult } from './process-host-protocol.js';

/** The host's file name next to the main bundle (vite.main.config.mjs). */
export const HOST_BUNDLE_NAME = 'process-host-child.js';
/** Give up waiting for a starting host after this long, and count it failed. */
export const HOST_START_TIMEOUT_MS = 10_000;
/** After this many failures in a row (crashes, starts that never finished,
 *  hosts that stopped answering), the host stays down and commands run in
 *  the main process. */
export const MAX_FAILURES = 3;
/** A host that ran this long before failing was healthy: its failure starts
 *  a new count, so crashes days apart don't add up to giving up. */
export const HEALTHY_UPTIME_MS = 10 * 60_000;
/** Wait this long before starting the host again after a failure. */
export const RESTART_DELAY_MS = 2_000;
/** A command with a timeout that hasn't been answered this long after its
 *  timeout means the host has stopped answering (execa would have killed the
 *  command and replied): the command fails as timed out and the host is
 *  restarted. Generous, because a slow launch ahead of it in the host delays
 *  when its timeout starts. */
export const DEADLINE_MARGIN_MS = 60_000;
/** A launch in the host this slow is noted in the logs: it would have
 *  frozen the window for that long. */
export const SLOW_HOSTED_LAUNCH_MS = 1_000;

/** Thrown for a command in flight when the host stops, unless it only reads
 *  (isReadOnly), in which case it runs again here. */
export const HOST_STOPPED_MESSAGE = 'The process host stopped before the command finished';

/** The parts of Electron's UtilityProcess the host uses. */
export interface HostProcess {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (type: string, location: string) => void): unknown;
  kill(): boolean;
}

type Timer = { unref?: () => void };

export interface ProcessHostDeps {
  /** Start the host's process. */
  fork: () => HostProcess;
  /** Run a command in this process. */
  runHere: (file: string, args: string[], options?: HostedOptions) => Promise<unknown>;
  /** Stop a process the host started, once the host is gone. */
  killPid?: (pid: number) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: unknown) => void;
  /** Where slow launches and failures are noted. */
  note?: (line: string) => void;
}

interface Pending {
  file: string;
  args: string[];
  options?: HostedOptions;
  label: string;
  /** Captured when the command was asked for: errors keep the caller's stack. */
  origin: Error;
  /** The command's process, once the host says it has started. */
  pid?: number;
  deadline?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type State = 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';

export function createProcessHost(deps: ProcessHostDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const killPid = deps.killPid ?? killQuietly;
  const note = deps.note ?? noteInLogs;

  let state: State = 'idle';
  let host: HostProcess | null = null;
  let failures = 0;
  let readyAt: number | null = null;
  let nextId = 0;
  let startTimer: unknown = null;
  let restartTimer: unknown = null;
  const pending = new Map<number, Pending>();

  function start(): void {
    if (state !== 'idle') return;
    launch();
  }

  function launch(): void {
    state = 'starting';
    readyAt = null;
    let child: HostProcess;
    try {
      child = deps.fork();
    } catch (e) {
      failed(`couldn't start: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    host = child;
    const timer = setTimer(() => {
      if (host !== child || state !== 'starting') return;
      host = null;
      child.kill();
      failed(`didn't start within ${HOST_START_TIMEOUT_MS / 1000} s`);
    }, HOST_START_TIMEOUT_MS);
    timer.unref?.();
    startTimer = timer;
    child.on('message', (message) => {
      if (host !== child) return;
      if (message === HOST_READY) {
        if (state !== 'starting') return;
        clearTimer(startTimer);
        state = 'ready';
        readyAt = now();
        return;
      }
      if (isHostStarted(message)) {
        const waiting = pending.get(message.id);
        if (waiting) waiting.pid = message.pid;
        return;
      }
      if (isHostReply(message)) settle(message);
    });
    // Electron sends 'exit' after this one; without a listener it would
    // throw in the main process.
    child.on('error', (type) => {
      if (host === child) note(`process host hit a fatal error (${type})`);
    });
    child.on('exit', (code) => {
      if (host !== child) return;
      host = null;
      clearTimer(startTimer);
      abandonPending(true);
      if (state === 'stopped') return;
      failed(`exited with code ${code}`);
    });
  }

  /** The host failed: try again after a pause, or give up for good. */
  function failed(reason: string): void {
    if (readyAt !== null && now() - readyAt >= HEALTHY_UPTIME_MS) failures = 0;
    readyAt = null;
    failures++;
    if (failures >= MAX_FAILURES) {
      state = 'failed';
      note(`process host ${reason}; git and gh run in the main process from now on`);
      return;
    }
    state = 'idle';
    note(`process host ${reason}; starting it again`);
    const timer = setTimer(() => {
      restartTimer = null;
      if (state === 'idle') launch();
    }, RESTART_DELAY_MS);
    timer.unref?.();
    restartTimer = timer;
  }

  function settle(reply: HostReply): void {
    const waiting = take(reply.id);
    if (!waiting) return;
    if (reply.launchMs >= SLOW_HOSTED_LAUNCH_MS) {
      note(`${waiting.label} took ${Math.round(reply.launchMs)} ms to start, in the process host (the window kept responding)`);
    }
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(fromCaller(reviveError(reply.error), waiting.origin));
  }

  /** Remove a command from the waiting list, with its deadline. */
  function take(id: number): Pending | undefined {
    const waiting = pending.get(id);
    if (!waiting) return undefined;
    pending.delete(id);
    if (waiting.deadline) clearTimer(waiting.deadline);
    return waiting;
  }

  /** The host is gone: stop what it started, run read-only commands again
   *  here (unless the app is quitting), and fail the rest. */
  function abandonPending(rerun: boolean): void {
    const waiting = [...pending.keys()].map(take).filter((p): p is Pending => !!p);
    for (const p of waiting) {
      if (p.pid !== undefined) killPid(p.pid);
      if (rerun && isReadOnly(p.file, p.args)) {
        deps.runHere(p.file, p.args, p.options).then(p.resolve, (e: unknown) => p.reject(e instanceof Error ? e : new Error(String(e))));
      } else {
        p.reject(fromCaller(new Error(`${HOST_STOPPED_MESSAGE}: ${p.label}`), p.origin));
      }
    }
  }

  /** A command with a timeout got no answer long after it: the host has
   *  stopped answering. Fail the command as timed out and restart the host
   *  (its exit handles the other commands). */
  function overdue(id: number, timeout: number): void {
    const waiting = take(id);
    if (!waiting) return;
    const error = Object.assign(new Error(`${waiting.label} got no answer from the process host within ${Math.round((timeout + DEADLINE_MARGIN_MS) / 1000)} s`), { timedOut: true });
    waiting.reject(fromCaller(error, waiting.origin));
    const child = host;
    if (child && state === 'ready') {
      note(`process host stopped answering (${waiting.label}); restarting it`);
      child.kill();
    }
  }

  function run(file: string, args: string[], options?: HostedOptions): Promise<unknown> {
    const child = host;
    if (state !== 'ready' || !child) return deps.runHere(file, args, options);
    const id = ++nextId;
    const request: HostRequest = options === undefined ? { id, file, args } : { id, file, args, options };
    const origin = new Error();
    return new Promise((resolve, reject) => {
      const waiting: Pending = { file, args, options, label: launchLabel(file, [file, ...args]), origin, resolve, reject };
      pending.set(id, waiting);
      try {
        child.postMessage(request);
      } catch {
        // Never delivered, so it can't have run: run it here instead.
        pending.delete(id);
        deps.runHere(file, args, options).then(resolve, reject);
        return;
      }
      const timeout = options?.timeout;
      if (timeout && timeout > 0) {
        const timer = setTimer(() => overdue(id, timeout), timeout + DEADLINE_MARGIN_MS);
        timer.unref?.();
        waiting.deadline = timer;
      }
    });
  }

  /** Stop the host for good (at quit). Commands in flight are stopped and
   *  fail: nothing is waiting for their answers any more. */
  function stop(): void {
    state = 'stopped';
    clearTimer(startTimer);
    if (restartTimer) clearTimer(restartTimer);
    const child = host;
    host = null;
    abandonPending(false);
    child?.kill();
  }

  return {
    start,
    stop,
    run,
    /** Whether commands go to the host right now. */
    get ready(): boolean { return state === 'ready'; },
  };
}

/** `error`, with the stack of the code that asked for the command (`origin`)
 *  rather than of the host's message handler or the host itself. */
function fromCaller(error: Error, origin: Error): Error {
  const frames = origin.stack?.split('\n').slice(1).join('\n');
  if (frames) error.stack = `${error.name}: ${error.message}\n${frames}`;
  return error;
}

/** git subcommands that only read, whatever their arguments. */
const READ_ONLY_GIT = new Set([
  '--version', 'rev-parse', 'status', 'log', 'diff', 'show', 'show-ref', 'rev-list', 'merge-base',
  'ls-files', 'ls-tree', 'cat-file', 'check-ignore', 'check-ref-format', 'for-each-ref',
]);
/** Flags that make `git branch` change something. */
const BRANCH_WRITE_FLAGS = /^(-[dDmMcCfu]|--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description)(=|$))/;
/** Flags that make `gh api` send something other than a GET. */
const GH_API_WRITE_FLAGS = /^(-[XfF]|--(method|field|raw-field|input)(=|$))/;

/**
 * Whether running this git or gh command a second time changes nothing, so it
 * can run again in the main process when the host dies under it. Anything
 * not known to be read-only isn't.
 */
export function isReadOnly(file: string, args: readonly string[]): boolean {
  const program = (file.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');
  const [sub, next] = args;
  const flags = args.slice(1).filter((a) => a.startsWith('-'));
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  if (program === 'git') {
    if (READ_ONLY_GIT.has(sub)) return true;
    switch (sub) {
      case 'symbolic-ref': return !flags.some((f) => f === '-d' || f === '--delete') && positional.length <= 1;
      case 'reflog': return next === undefined || next === 'show';
      case 'branch': return positional.length === 0 && !flags.some((f) => BRANCH_WRITE_FLAGS.test(f));
      case 'remote': return positional.length === 0;
      case 'config': return flags.length === 0 && positional.length === 1;
      case 'worktree': return next === 'list';
      default: return false;
    }
  }
  if (program === 'gh') {
    if (sub === '--version') return true;
    if (sub === 'pr') return ['view', 'list', 'checks', 'status', 'diff'].includes(next);
    if (sub === 'auth') return next === 'status';
    if (sub === 'api') return !args.slice(1).some((a) => GH_API_WRITE_FLAGS.test(a));
  }
  return false;
}

/** Stop a process, if it's still there. */
function killQuietly(pid: number): void {
  try {
    process.kill(pid);
  } catch { /* already gone */ }
}

function noteInLogs(line: string): void {
  perfLine('host', line);
  logger.info(`[process-host] ${line}`);
}

/** The host script. It's built next to the main bundle in dist/main. */
function hostScriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), HOST_BUNDLE_NAME);
}

/** Run a command in the main process. The whole call is timed for the freeze
 *  log: execa's PATH search runs before the launch it already times. */
function runInMain(file: string, args: string[], options?: HostedOptions): Promise<unknown> {
  return freezeLog.timeWork(`${launchLabel(file, [file, ...args])} setup and start`, () =>
    options === undefined ? execa(file, args) : execa(file, args, options));
}

const processHost = createProcessHost({
  fork: () => utilityProcess.fork(hostScriptPath(), [], { serviceName: 'Grove process host' }),
  runHere: runInMain,
});

/**
 * Run `file` with `args` like execa, in the process host when it's up.
 * Resolves with execa's result fields, or rejects with an error that carries
 * them (`stderr`, `exitCode`, `timedOut`, `code`).
 */
export function runProcess(file: string, args: string[], options: HostedOptions & { encoding: 'buffer' }): Promise<ProcessResult<Uint8Array>>;
export function runProcess(file: string, args: string[], options?: HostedOptions): Promise<ProcessResult>;
export function runProcess(file: string, args: string[], options?: HostedOptions): Promise<unknown> {
  return processHost.run(file, args, options);
}

/** Start the process host. Electron allows it once the app is ready. */
export function startProcessHost(): void {
  processHost.start();
}

/** Stop the process host (at quit), so its exit isn't taken for a crash. */
export function stopProcessHost(): void {
  processHost.stop();
}
