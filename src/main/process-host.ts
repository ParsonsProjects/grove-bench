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
 * MAX_FAILURES times, commands run in the main process as they did before.
 * Tests never start it, so their execa mocks see every call.
 */
import { utilityProcess } from 'electron';
import { execa } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeLog, launchLabel } from './freeze-log.js';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';
import {
  HOST_READY, isHostReply, reviveError,
  type HostedOptions, type HostReply, type HostRequest, type ProcessResult,
} from './process-host-protocol.js';

export type { HostedOptions, ProcessResult } from './process-host-protocol.js';

/** The host's file name next to the main bundle (vite.main.config.mjs). */
export const HOST_BUNDLE_NAME = 'process-host-child.js';
/** Give up waiting for a starting host after this long, and count it failed. */
export const HOST_START_TIMEOUT_MS = 10_000;
/** After this many failures (crashes, or starts that never finished), the
 *  host stays down and commands run in the main process. */
export const MAX_FAILURES = 3;
/** Wait this long before starting the host again after a failure. */
export const RESTART_DELAY_MS = 2_000;
/** A launch in the host this slow is noted in the logs: it would have
 *  frozen the window for that long. */
export const SLOW_HOSTED_LAUNCH_MS = 1_000;

/** Thrown for a command in flight when the host stops. The command may or
 *  may not have run, so it isn't run again here. */
export const HOST_STOPPED_MESSAGE = 'The process host stopped before the command finished';

/** The parts of Electron's UtilityProcess the host uses. */
export interface HostProcess {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface ProcessHostDeps {
  /** Start the host's process. */
  fork: () => HostProcess;
  /** Run a command in this process. */
  runHere: (file: string, args: string[], options?: HostedOptions) => Promise<unknown>;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (timer: unknown) => void;
  /** Where slow launches and failures are noted. */
  note?: (line: string) => void;
}

interface Pending {
  label: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type State = 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';

export function createProcessHost(deps: ProcessHostDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const note = deps.note ?? noteInLogs;

  let state: State = 'idle';
  let host: HostProcess | null = null;
  let failures = 0;
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
        return;
      }
      if (isHostReply(message)) settle(message);
    });
    child.on('exit', (code) => {
      if (host !== child) return;
      host = null;
      clearTimer(startTimer);
      rejectPending();
      if (state === 'stopped') return;
      failed(`exited with code ${code}`);
    });
  }

  /** The host failed: try again after a pause, or give up for good. */
  function failed(reason: string): void {
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
    const waiting = pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id);
    if (reply.launchMs >= SLOW_HOSTED_LAUNCH_MS) {
      note(`${waiting.label} took ${Math.round(reply.launchMs)} ms to start, in the process host (the window kept responding)`);
    }
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(reviveError(reply.error));
  }

  function rejectPending(): void {
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) p.reject(new Error(`${HOST_STOPPED_MESSAGE}: ${p.label}`));
  }

  function run(file: string, args: string[], options?: HostedOptions): Promise<unknown> {
    const child = host;
    if (state !== 'ready' || !child) return deps.runHere(file, args, options);
    const id = ++nextId;
    const request: HostRequest = options === undefined ? { id, file, args } : { id, file, args, options };
    return new Promise((resolve, reject) => {
      pending.set(id, { label: launchLabel(file, [file, ...args]), resolve, reject });
      try {
        child.postMessage(request);
      } catch {
        // Never delivered, so it can't have run: run it here instead.
        pending.delete(id);
        deps.runHere(file, args, options).then(resolve, reject);
      }
    });
  }

  /** Stop the host for good (at quit). Commands still in flight fail. */
  function stop(): void {
    state = 'stopped';
    clearTimer(startTimer);
    if (restartTimer) clearTimer(restartTimer);
    const child = host;
    host = null;
    rejectPending();
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
