/**
 * Process host: git runs from an Electron utility process
 * (process-host-child.ts), so starting it never blocks the main process,
 * as do the main process's other short commands (taskkill, ps, where, the
 * editor CLIs).
 * So do the agents' programs (claude, ACP agents), which keep running and
 * stream their input and output through a second host of their own, the agent host
 * (process-host-spawn.ts), and the commands that can run long or hang
 * (runInAgentHost, process-host-run.ts): the claude CLI's auth, mcp and
 * plugin calls, and gh, which waits on the network. Kept apart because the
 * git host is restarted when a command goes unanswered, and a restart stops
 * whatever the host started.
 *
 * Starting a process holds whichever process asks for it until the OS has
 * created it. On Windows that is execa's PATH search (cross-spawn stats every
 * PATH folder for every PATHEXT extension) plus CreateProcess, which the
 * freeze log measured at tens of ms per git call, and now and then seconds.
 * While the main process waits, the window can't respond. The host waits
 * instead.
 *
 * Before the app is ready (the host isn't started yet), once it has failed
 * MAX_FAILURES times in a row, and after it has stopped at quit, commands run
 * in the main process as they did before, except those that can be skipped
 * (runProcessInHost), which fail instead. Tests never start it, so their
 * execa mocks see every call.
 *
 * A command asked for while the host starts, or restarts after a crash or a
 * kill, waits for it (in order) rather than run here: at launch the app
 * restores every project and thread at once, dozens of git calls in the
 * first seconds, which ran here and froze the window. It waits at most
 * HOST_WAIT_MS, and no longer once that start has failed: then it runs here
 * (or, host-only, fails) as it did before. Its timeout, and the deadline for
 * the host's answer, count from when it is sent, not from when it was asked
 * for, so it can take up to HOST_WAIT_MS longer than its timeout.
 *
 * When the host dies with commands in flight, their processes are stopped
 * (their execa timeouts died with the host). Read-only ones and those marked
 * safe to run again (`idempotent`) were never answered, so they wait for the
 * restart as new commands do, ahead of them, and run here only as those
 * would (it isn't up in time, its start fails, or it has given up), or if a
 * host died running them before (they may be what kills it). The rest fail:
 * they may have done their work, so they don't run twice. At quit (stop)
 * all but the idempotent ones fail, and those run here. A host that stops
 * answering is killed and takes no new commands until it has restarted; the
 * command that found it out fails as timed out, unless it is idempotent. A
 * spawned process can't outlive the host either (its pipes were the
 * host's): it is stopped and reported as exited.
 *
 * A command marked `urgent` (taskkill) never waits for the host: when it
 * isn't up, or dies under it, the command runs here at once.
 *
 * A process spawned while the host is starting waits for it, rather than
 * starting here: at launch the open thread's agent starts within seconds,
 * and that is the launch that froze the window.
 */
import { utilityProcess } from 'electron';
import { execa } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeLog, launchLabel } from './freeze-log.js';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';
import {
  HOST_READY, isHostReply, isHostStarted, isSpawnEvent, reviveError,
  type HostedOptions, type HostReply, type HostRequest, type ProcessResult, type SpawnEvent, type SpawnRequest,
} from './process-host-protocol.js';
import { createSpawnRunner, HostedProcess, type SpawnRunner } from './process-host-spawn.js';

export type { HostedOptions, ProcessResult } from './process-host-protocol.js';
export type { HostedProcess } from './process-host-spawn.js';

/** Where a spawned process runs and how it starts. */
export interface SpawnProcessOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Find `file` as a shell would, npm's .cmd shims included (SpawnRequest). */
  findCommand?: boolean;
  /** 'ignore': its standard output is thrown away where it runs (SpawnRequest). */
  stdout?: 'pipe' | 'ignore';
  /** Run `file` and `args` as one command line in a shell (SpawnRequest). */
  shell?: boolean;
}

/** The host's file name next to the main bundle (vite.main.config.mjs). */
export const HOST_BUNDLE_NAME = 'process-host-child.js';
/** Give up waiting for a starting host after this long, and count it failed. */
export const HOST_START_TIMEOUT_MS = 10_000;
/** The longest a command waits for a starting (or restarting) host before it
 *  runs in the main process after all. A utility process normally starts in
 *  well under a second, and a restart takes RESTART_DELAY_MS plus a start;
 *  5 s covers both on a slow, busy PC at login. A start that takes longer is
 *  probably stuck (HOST_START_TIMEOUT_MS ends it), and the window shouldn't
 *  wait for its git status all that time. */
export const HOST_WAIT_MS = 5_000;
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
/** A deadline timer that runs this much later than it was set for ran late
 *  because the computer slept (Windows counts the sleep), or this process
 *  froze: the host had no time to answer, so the command gets its time again
 *  rather than the host being taken for hung. On 9 Oct a `gh pr` deadline
 *  fired the moment the computer woke and the host was restarted. */
export const LATE_DEADLINE_MS = 30_000;
/** A launch in the host this slow is noted in the logs: it would have
 *  frozen the window for that long. */
export const SLOW_HOSTED_LAUNCH_MS = 1_000;

/** Thrown for a command in flight when the host stops, unless it only reads
 *  (isReadOnly) or is idempotent, in which case it runs again (in the
 *  restarted host, or here). */
export const HOST_STOPPED_MESSAGE = 'The process host stopped before the command finished';

/** The parts of Electron's UtilityProcess the host uses. */
export interface HostProcess {
  /** Its process id, once it is running. */
  readonly pid?: number;
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
  /** Start processes in this process, posting what they do. */
  spawnHere?: (post: (event: SpawnEvent) => void) => SpawnRunner;
  /** Stop a process the host started, once the host is gone. */
  killPid?: (pid: number) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: unknown) => void;
  /** Where slow launches and failures are noted. */
  note?: (line: string) => void;
  /** Hand on a chunk of a spawned process's output (`deliver`), timing it
   *  for the freeze log (freezeLog.timeAgentOutput). By default it's only
   *  handed on. */
  timeOutput?: (chars: number, deliver: () => void) => void;
  /** What the notes call the host, and what it runs. */
  name?: string;
  runs?: string;
}

interface Pending {
  file: string;
  args: string[];
  options?: HostedOptions;
  label: string;
  /** Asked for with runInHost: it never runs in this process. */
  hostOnly: boolean;
  /** Safe to run again (HostedOptions.idempotent). */
  idempotent: boolean;
  /** Never waits for the host (HostedOptions.urgent). */
  urgent: boolean;
  /** A host died running it, and it went back to wait for the next. */
  requeued?: boolean;
  /** Captured when the command was asked for: errors keep the caller's stack. */
  origin: Error;
  /** The command's process, once the host says it has started. */
  pid?: number;
  deadline?: unknown;
  /** When the deadline was set (now()). */
  deadlineSetAt?: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** 'stopping': killed for not answering (overdue), until its exit. It takes
 *  no new commands, which would only fail with it: they wait for the host
 *  that replaces it. */
type State = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export function createProcessHost(deps: ProcessHostDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const killPid = deps.killPid ?? killQuietly;
  const note = deps.note ?? noteInLogs;
  const name = deps.name ?? 'process host';
  const timeOutput = deps.timeOutput ?? ((_chars: number, deliver: () => void) => deliver());

  let state: State = 'idle';
  let host: HostProcess | null = null;
  let failures = 0;
  let readyAt: number | null = null;
  /** When the host was last launched (now()). */
  let launchedAt = 0;
  let nextId = 0;
  let startTimer: unknown = null;
  let restartTimer: unknown = null;
  const pending = new Map<number, Pending>();
  /** Commands waiting for a starting or restarting host, in the order they
   *  were asked for. Not sent, so they can't have run. */
  const queued: Pending[] = [];
  /** Ends the wait for the first of them (HOST_WAIT_MS). */
  let waitTimer: unknown = null;
  /** This start ran past HOST_WAIT_MS: commands run here until it is up or
   *  has failed, rather than each wait as long. */
  let waitedOut = false;
  /** Processes running in the host, by request id. */
  const spawned = new Map<number, HostedProcess>();
  /** Spawns waiting for a starting host: told whether it came up. */
  const waitingForHost: ((ready: boolean) => void)[] = [];

  function start(): void {
    if (state !== 'idle') return;
    launch();
  }

  function launch(): void {
    state = 'starting';
    readyAt = null;
    launchedAt = now();
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
        sendQueued(child);
        hostCameUp(true);
        return;
      }
      if (isSpawnEvent(message)) {
        received(message);
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
      if (host === child) note(`${name} hit a fatal error (${type})`);
    });
    child.on('exit', (code) => {
      if (host !== child) return;
      host = null;
      clearTimer(startTimer);
      abandonPending(true);
      loseSpawned();
      if (state === 'stopped') return;
      failed(`exited with code ${code}`);
    });
  }

  /** The host failed: try again after a pause, or give up for good. */
  function failed(reason: string): void {
    // It never came up, as opposed to dying once it was (a crash, or a kill
    // for not answering).
    const startFailed = state === 'starting';
    if (readyAt !== null && now() - readyAt >= HEALTHY_UPTIME_MS) failures = 0;
    readyAt = null;
    failures++;
    // Spawns waiting on this start go ahead here, rather than wait through
    // more restarts.
    hostCameUp(false);
    // The next start gets its own wait.
    waitedOut = false;
    if (failures >= MAX_FAILURES) {
      state = 'failed';
      note(`${name} ${reason}; ${deps.runs ?? 'git commands'} run in the main process from now on`);
      runQueuedHere();
      return;
    }
    state = 'idle';
    note(`${name} ${reason}; starting it again`);
    const timer = setTimer(() => {
      restartTimer = null;
      if (state === 'idle') launch();
    }, RESTART_DELAY_MS);
    timer.unref?.();
    restartTimer = timer;
    // Commands waiting on this start run here too, as the spawns do.
    // Those waiting since the host died wait on for its restart (within
    // HOST_WAIT_MS): the restart is what they were waiting for.
    if (startFailed) runQueuedHere();
  }

  function hostCameUp(ready: boolean): void {
    for (const go of waitingForHost.splice(0)) go(ready);
  }

  /** The host is on its way up: starting, or restarting after it died (until
   *  its exit if it was killed, then the pause before it starts again). A
   *  command asked for now waits for it, unless this start has already
   *  taken too long. */
  function comingUp(): boolean {
    if (waitedOut) return false;
    return state === 'starting' || state === 'stopping' || (state === 'idle' && restartTimer !== null);
  }

  /** Hold commands until the host is up, for HOST_WAIT_MS at most (counted
   *  from the first command waiting): after those already waiting, or, those
   *  a dying host was running (`first`), ahead of them. */
  function wait(commands: Pending[], first = false): void {
    if (first) queued.unshift(...commands);
    else queued.push(...commands);
    if (waitTimer !== null) return;
    const timer = setTimer(waitedTooLong, HOST_WAIT_MS);
    timer.unref?.();
    waitTimer = timer;
  }

  /** The host took longer than HOST_WAIT_MS: what waited runs here, and so
   *  does what follows, until the host is up or this start has failed. */
  function waitedTooLong(): void {
    waitTimer = null;
    if (queued.length === 0) return;
    waitedOut = true;
    note(`${name} wasn't up after ${HOST_WAIT_MS / 1000} s; ${countOf(queued.length)} that waited for it, and those after them until it is, run in the main process`);
    runQueuedHere();
  }

  function stopWaitTimer(): void {
    if (waitTimer === null) return;
    clearTimer(waitTimer);
    waitTimer = null;
  }

  /** The host is up: send what waited for it, in order. */
  function sendQueued(child: HostProcess): void {
    stopWaitTimer();
    waitedOut = false;
    if (queued.length === 0) return;
    note(`${name} up in ${Math.round(now() - launchedAt)} ms; ${countOf(queued.length)} waited for it`);
    for (const command of queued.splice(0)) send(command, child);
  }

  /** The host won't be up in time, or at all: what waited for it runs here
   *  after all, in order (host-only commands fail). */
  function runQueuedHere(): void {
    stopWaitTimer();
    for (const command of queued.splice(0)) fallBack(command);
  }

  /** Run a command here, as before the host, or, host-only, refuse it. Every
   *  command that runs here comes through this, so all settle alike: a
   *  throw from runHere (even before it returns a promise) fails only this
   *  command, not the others run here with it; a rejection that isn't an
   *  Error becomes one; and that, like the refusal, has the caller's stack.
   *  runHere is called before this returns. */
  function fallBack(command: Pending): void {
    if (command.hostOnly) {
      command.reject(fromCaller(new Error(`The ${name} isn't running, so ${command.label} didn't run`), command.origin));
      return;
    }
    new Promise((resolve) => { resolve(deps.runHere(command.file, command.args, command.options)); })
      .then(command.resolve, (e: unknown) => command.reject(e instanceof Error ? e : fromCaller(new Error(String(e)), command.origin)));
  }

  /** A spawned process did something: pass it on. */
  function received(event: SpawnEvent): void {
    const proc = spawned.get(event.id);
    if (!proc) return;
    if (event.type === 'spawned' && event.launchMs >= SLOW_HOSTED_LAUNCH_MS) {
      note(`${proc.label} took ${Math.round(event.launchMs)} ms to start, in the ${name} (the window kept responding)`);
    }
    if (event.type === 'close') spawned.delete(event.id);
    deliver(proc, event);
  }

  /** Pass what a spawned process did on to it, timing its output. */
  function deliver(proc: HostedProcess, event: SpawnEvent): void {
    if (event.type === 'stdout' || event.type === 'stderr') timeOutput(event.data.length, () => proc.receive(event));
    else proc.receive(event);
  }

  /** The host is gone, and the processes it started can't go on without
   *  their pipes: stop them, and end them here. */
  function loseSpawned(): void {
    const lost = [...spawned.values()];
    spawned.clear();
    for (const proc of lost) {
      if (proc.pid !== undefined) killPid(proc.pid);
      if (state !== 'stopped') note(`${proc.label} stopped with the ${name}`);
      proc.lost(state !== 'stopped');
    }
  }

  function settle(reply: HostReply): void {
    const waiting = take(reply.id);
    if (!waiting) return;
    if (reply.launchMs >= SLOW_HOSTED_LAUNCH_MS) {
      note(`${waiting.label} took ${Math.round(reply.launchMs)} ms to start, in the ${name} (the window kept responding)`);
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

  /** The host is gone: stop what it started, and fail the commands it was
   *  running, except those safe to repeat. They were never answered, so they
   *  go back to wait, ahead of any asked for since, and the caller decides
   *  when they run, as for those: the exit (failed()) keeps them for the
   *  restart, or runs them here if there won't be one; stop() runs them
   *  here. An urgent one runs here at once, as does one a host already died
   *  running: it may be what kills them. At quit (`rerun` false) only those
   *  marked idempotent run again, since their callers need them done
   *  (taskkill); nothing waits for a read-only git command's answer then. */
  function abandonPending(rerun: boolean): void {
    const waiting = [...pending.keys()].map(take).filter((p): p is Pending => !!p);
    const again: Pending[] = [];
    for (const p of waiting) {
      if (p.pid !== undefined) killPid(p.pid);
      if (p.hostOnly || !(p.idempotent || (rerun && isReadOnly(p.file, p.args)))) {
        p.reject(fromCaller(new Error(`${HOST_STOPPED_MESSAGE}: ${p.label}`), p.origin));
      } else if (p.urgent || p.requeued) {
        // Here, execa's own timeout ends it: it can't go overdue.
        fallBack(p);
      } else {
        // Gone with the host: Windows may give its pid to another process.
        p.pid = undefined;
        p.requeued = true;
        again.push(p);
      }
    }
    if (again.length > 0) wait(again, true);
  }

  /** Fail a command as timed out if it gets no answer long after its timeout. */
  function setDeadline(id: number, waiting: Pending, timeout: number): void {
    const timer = setTimer(() => overdue(id, timeout), timeout + DEADLINE_MARGIN_MS);
    timer.unref?.();
    waiting.deadline = timer;
    waiting.deadlineSetAt = now();
  }

  /** A command with a timeout got no answer long after it: the host has
   *  stopped answering. Restart the host (its exit handles the other
   *  commands), taking no new commands meanwhile. The command fails as timed
   *  out, or, if it is safe to repeat, runs again here: its caller needs it
   *  done (taskkill). Unless the deadline itself came late
   *  (LATE_DEADLINE_MS): then the command waits its full time again. */
  function overdue(id: number, timeout: number): void {
    const current = pending.get(id);
    if (current?.deadlineSetAt !== undefined && now() - current.deadlineSetAt - (timeout + DEADLINE_MARGIN_MS) >= LATE_DEADLINE_MS) {
      setDeadline(id, current, timeout);
      return;
    }
    const waiting = take(id);
    if (!waiting) return;
    const child = host;
    if (child && state === 'ready') {
      note(`${name} stopped answering (${waiting.label}); restarting it`);
      // Before anyone can retry: until the exit, `host` is still this one.
      state = 'stopping';
      child.kill();
    }
    if (waiting.idempotent && !waiting.hostOnly) {
      fallBack(waiting);
      return;
    }
    const error = Object.assign(new Error(`${waiting.label} got no answer from the process host within ${Math.round((timeout + DEADLINE_MARGIN_MS) / 1000)} s`), { timedOut: true });
    waiting.reject(fromCaller(error, waiting.origin));
  }

  /** Run a command in the host, or, unless `hostOnly`, here when the host
   *  can't take it. While the host is on its way up, it waits for it,
   *  unless it is urgent. */
  function run(file: string, args: string[], hostedOptions: HostedOptions | undefined, hostOnly: boolean): Promise<unknown> {
    const up = state === 'ready' ? host : null;
    const label = launchLabel(file, [file, ...args]);
    // `idempotent` and `urgent` stay here; execa gets the rest.
    const { idempotent = false, urgent = false, ...rest } = hostedOptions ?? {};
    const options = hostedOptions === undefined ? undefined : rest;
    const origin = new Error();
    return new Promise((resolve, reject) => {
      const command: Pending = { file, args, options, label, hostOnly, idempotent, urgent, origin, resolve, reject };
      if (up) send(command, up);
      else if (!urgent && comingUp()) wait([command]);
      else fallBack(command);
    });
  }

  /** Send a command to the host. Its deadline counts from now, as its
   *  timeout does in the host. */
  function send(command: Pending, child: HostProcess): void {
    const { file, args, options } = command;
    const id = ++nextId;
    const request: HostRequest = options === undefined ? { id, file, args } : { id, file, args, options };
    pending.set(id, command);
    try {
      child.postMessage(request);
    } catch {
      // Never delivered, so it can't have run: run it here instead (or,
      // host-only, not at all).
      pending.delete(id);
      fallBack(command);
      return;
    }
    const timeout = options?.timeout;
    if (timeout && timeout > 0) setDeadline(id, command, timeout);
  }

  /**
   * Start a long-running process, in the host when it's up or starting.
   * Returns at once, before the process exists: its input waits until then,
   * and its pid, output and exit follow.
   */
  function spawn(file: string, args: string[], options: SpawnProcessOptions = {}): HostedProcess {
    const proc = new HostedProcess(launchLabel(file, [file, ...args]));
    const request: Omit<SpawnRequest, 'id'> = { type: 'spawn', file, args, ...options };
    const launch = (inHost: boolean) => {
      // Stopped before it started: there's nothing to start.
      if (proc.killed) {
        proc.lost();
        return;
      }
      const child = host;
      if (inHost && state === 'ready' && child) {
        const id = ++nextId;
        spawned.set(id, proc);
        try {
          child.postMessage({ ...request, id });
        } catch {
          // Never delivered, so it can't have started: start it here instead.
          spawned.delete(id);
          launch(false);
          return;
        }
        proc.connect((command) => {
          // A new host never had it; the old one's exit ended it here.
          if (host !== child) return;
          try { child.postMessage({ ...command, id }); } catch { /* the host is going */ }
        });
        return;
      }
      const runner = (deps.spawnHere ?? createSpawnRunner)((event) => deliver(proc, event));
      runner.handle({ ...request, id: 0 });
      proc.connect((command) => runner.handle({ ...command, id: 0 }));
    };
    if (state === 'ready') launch(true);
    else if (state === 'starting' || (state === 'idle' && restartTimer)) waitingForHost.push(launch);
    else launch(false);
    return proc;
  }

  /** Stop the host for good (at quit). Commands in flight are stopped and
   *  fail, nothing waiting for their answers any more, except idempotent
   *  ones, which run here. Those waiting for a restart were never sent: they
   *  run here, as later ones will. */
  function stop(): void {
    state = 'stopped';
    clearTimer(startTimer);
    if (restartTimer) clearTimer(restartTimer);
    const child = host;
    host = null;
    abandonPending(false);
    runQueuedHere();
    loseSpawned();
    hostCameUp(false);
    child?.kill();
  }

  return {
    start,
    stop,
    run: (file: string, args: string[], options?: HostedOptions) => run(file, args, options, false),
    /** Like run, but never in this process: fails when the host isn't up (or
     *  dies), for work that can be skipped rather than freeze the window. */
    runInHost: (file: string, args: string[], options?: HostedOptions) => run(file, args, options, true),
    spawn,
    /** Whether commands go to the host right now. */
    get ready(): boolean { return state === 'ready'; },
    /** The host's process id while it's up. */
    get pid(): number | undefined { return state === 'ready' ? host?.pid : undefined; },
  };
}

/** `error`, with the stack of the code that asked for the command (`origin`)
 *  rather than of the host's message handler or the host itself. */
function fromCaller(error: Error, origin: Error): Error {
  const frames = origin.stack?.split('\n').slice(1).join('\n');
  if (frames) error.stack = `${error.name}: ${error.message}\n${frames}`;
  return error;
}

/** "1 command", "3 commands". */
function countOf(n: number): string {
  return `${n} command${n === 1 ? '' : 's'}`;
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
 * can run again when its host dies under it: a git command in the restarted
 * host or the main process, a gh call in the agent host (gh.ts marks those
 * `idempotent` for runInAgentHost). Anything not known to be read-only isn't.
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

/** The same host script, for the agents' long-running processes only. */
const agentHost = createProcessHost({
  fork: () => utilityProcess.fork(hostScriptPath(), [], { serviceName: 'Grove agent host' }),
  runHere: runInMain,
  name: 'agent host',
  runs: 'agents',
  timeOutput: freezeLog.timeAgentOutput,
});

/**
 * Run `file` with `args` like execa, in the process host when it's up, or
 * once it is when it's starting (for HOST_WAIT_MS at most).
 * Resolves with execa's result fields, or rejects with an error that carries
 * them (`stderr`, `exitCode`, `timedOut`, `code`).
 */
export function runProcess(file: string, args: string[], options: HostedOptions & { encoding: 'buffer' }): Promise<ProcessResult<Uint8Array>>;
export function runProcess(file: string, args: string[], options?: HostedOptions): Promise<ProcessResult>;
export function runProcess(file: string, args: string[], options?: HostedOptions): Promise<unknown> {
  return processHost.run(file, args, options);
}

/**
 * runProcess, but only in the process host: rejects when the host isn't up
 * (before it is started, once it has given up or stopped, or when it doesn't
 * come up within HOST_WAIT_MS), rather than run the command in the main
 * process. For work that can be skipped, such as the health
 * line's process list (process-memory.ts).
 */
export function runProcessInHost(file: string, args: string[], options?: HostedOptions): Promise<ProcessResult> {
  return processHost.runInHost(file, args, options) as Promise<ProcessResult>;
}

/** The agent host's process id while it's up. The agents' programs are its
 *  children. */
export function agentHostPid(): number | undefined {
  return agentHost.pid;
}

/**
 * Start `file` with `args` like Node's spawn (piped stdio, no console
 * window), in the agent host when it's up or starting, so the window never
 * waits for the OS (or an antivirus) to create it. Returns at once.
 */
export function spawnProcess(file: string, args: string[], options?: SpawnProcessOptions): HostedProcess {
  return agentHost.spawn(file, args, options);
}

/** Start the process and agent hosts. Electron allows it once the app is ready. */
export function startProcessHost(): void {
  processHost.start();
  agentHost.start();
}

/** Stop the process and agent hosts (at quit), so their exit isn't taken for
 *  a crash. */
export function stopProcessHost(): void {
  processHost.stop();
  agentHost.stop();
}
