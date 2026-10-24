/**
 * Long-running processes started from the process host (process-host.ts):
 * the agents' programs (claude, ACP agents). Starting a process holds
 * whichever process asks until the OS has created it. On the main process the freeze log measured
 * every claude.exe launch at 1 s or more, and up to 21 s on a PC running an
 * antivirus, with the window frozen throughout. From the host, only the host
 * waits.
 *
 * HostedProcess is what the main process holds. It looks like the
 * ChildProcess the agent SDK expects (stdin, stdout, exitCode, kill, 'exit')
 * and follows the SpawnEvents it is given. createSpawnRunner starts the real
 * process and reports those events; it runs in the host, or in the main
 * process when the host is down. Only Node (and cross-spawn) here: the host
 * has no `app`.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
  reviveError, serializeError, type SpawnEvent, type SpawnRequest, type StdioRequest,
} from './process-host-protocol.js';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** Input for, or a request to stop, a process: a StdioRequest before it is
 *  addressed to one. */
export type ProcessCommand = WithoutId<StdioRequest>;

export class HostedProcess extends EventEmitter {
  readonly stdin: Writable;
  /** Output arrives decoded (createSpawnRunner), and these streams hand it
   *  on as the same strings. Without an encoding, a Readable turns each
   *  string into a Buffer that the reader (the agent SDK's readline)
   *  decodes again: a quarter of the main process's time on a 200 KB tool
   *  result. */
  readonly stdout = new Readable({ read() {}, encoding: 'utf8' });
  readonly stderr = new Readable({ read() {}, encoding: 'utf8' });
  /** Set once the OS has created the process. */
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  /** Ended because its host died (lost(true)) before it exited by itself, so
   *  it could run again. Not when the host was stopped at quit. */
  hostDied = false;
  private exited = false;
  private closed = false;
  private stdoutEnded = false;
  private stderrEnded = false;
  private send: ((command: ProcessCommand) => void) | null = null;
  private queued: ProcessCommand[] = [];

  constructor(readonly label: string) {
    super();
    this.stdin = new Writable({
      decodeStrings: false,
      write: (chunk: string | Uint8Array, _encoding, callback) => {
        this.command({ type: 'stdin', data: chunk });
        callback();
      },
      final: (callback) => {
        this.command({ type: 'stdin-end' });
        callback();
      },
    });
  }

  /** Send input and stop requests to wherever the process runs. Until this
   *  is called (the host is still starting), they wait. */
  connect(send: (command: ProcessCommand) => void): void {
    this.send = send;
    const queued = this.queued;
    this.queued = [];
    for (const command of queued) send(command);
  }

  /** Stop the process, like ChildProcess.kill. Sent on, so it takes effect
   *  once the process's host gets it. */
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.exited) return false;
    this.command({ type: 'kill', signal });
    this.killed = true;
    return true;
  }

  /** Resolves with the pid once the OS has created the process (its host
   *  reports it a moment after spawnProcess returns), or with undefined if
   *  it ends without starting. */
  started(): Promise<number | undefined> {
    if (this.pid !== undefined || this.exited || this.closed) return Promise.resolve(this.pid);
    return new Promise((resolve) => {
      const done = () => {
        this.off('spawn', done);
        this.off('exit', done);
        this.off('close', done);
        resolve(this.pid);
      };
      this.on('spawn', done);
      this.on('exit', done);
      this.on('close', done);
    });
  }

  /** Apply what the process did. */
  receive(event: SpawnEvent): void {
    switch (event.type) {
      case 'spawned':
        this.pid = event.pid;
        this.emit('spawn');
        break;
      case 'stdout':
        if (!this.stdoutEnded) this.stdout.push(event.data);
        break;
      case 'stderr':
        if (!this.stderrEnded) this.stderr.push(event.data);
        break;
      case 'stdout-end':
        this.endStdout();
        break;
      case 'stderr-end':
        this.endStderr();
        break;
      case 'stdin-error':
        this.stdin.destroy(reviveError(event.error));
        break;
      case 'error':
        // ChildProcess would throw with no listener; this runs in the host's
        // message handler, where a throw would take the main process down.
        if (this.listenerCount('error') > 0) this.emit('error', reviveError(event.error));
        break;
      case 'exit':
        this.exit(event.code, event.signal as NodeJS.Signals | null);
        break;
      case 'close':
        this.close();
        break;
    }
  }

  /** The process's host went away, so the process was stopped with it (or
   *  never started): end it here too. `hostDied`: the host died, rather than
   *  being stopped at quit. */
  lost(hostDied = false): void {
    if (hostDied && !this.exited) this.hostDied = true;
    this.exit(null, 'SIGKILL');
    this.close();
  }

  private command(command: ProcessCommand): void {
    if (this.closed) return;
    if (this.send) this.send(command);
    else this.queued.push(command);
  }

  private exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  private close(): void {
    if (this.closed) return;
    this.endStdout();
    this.endStderr();
    this.closed = true;
    this.queued = [];
    this.emit('close', this.exitCode, this.signalCode);
  }

  private endStdout(): void {
    if (this.stdoutEnded) return;
    this.stdoutEnded = true;
    this.stdout.push(null);
  }

  private endStderr(): void {
    if (this.stderrEnded) return;
    this.stderrEnded = true;
    this.stderr.push(null);
  }
}

export interface SpawnRunner {
  handle(request: SpawnRequest | StdioRequest): void;
}

/**
 * Start processes and run their input and stop requests, posting what each
 * one does. Output is decoded as UTF-8 here, so a character split across two
 * reads still arrives whole.
 */
export function createSpawnRunner(
  post: (event: SpawnEvent) => void,
  spawn: typeof nodeSpawn = nodeSpawn,
  now: () => number = () => performance.now(),
): SpawnRunner {
  const children = new Map<number, ChildProcess>();

  function start({ id, file, args, cwd, env, findCommand, stdout, shell }: SpawnRequest): void {
    const startedAt = now();
    let child: ChildProcess;
    let notFound = false;
    try {
      // stdout 'ignore': the process's output goes nowhere, so none is posted.
      const stdio: SpawnOptions['stdio'] = stdout === 'ignore' ? ['pipe', 'ignore', 'pipe'] : 'pipe';
      const options: SpawnOptions = { cwd, env, stdio, windowsHide: true, ...(shell ? { shell: true } : {}) };
      // A shell gets one command line, joined here as execa joins it (Node
      // would join it too, warning that it does from Node 24). Otherwise
      // cross-spawn's parse finds the command and wraps a .cmd shim in
      // cmd.exe, as execa does before it spawns. It reads the disk, which is
      // why it runs here and not on the main process.
      const parsed = !shell && findCommand ? crossSpawn._parse(file, args, options) : undefined;
      const launch = shell ? { command: [file, ...args].join(' '), args: [], options }
        : parsed ?? { command: file, args, options };
      // On Windows a command it didn't find (no `file`) still starts, as
      // cmd.exe, which exits 1: "'npm' is not recognized as an internal or
      // external command".
      notFound = parsed !== undefined && process.platform === 'win32' && !parsed.file;
      child = spawn(launch.command, launch.args, launch.options);
    } catch (e) {
      // Node throws some failed starts (EINVAL, EPERM, ENAMETOOLONG, a bad
      // argument) rather than emitting them. Report them on the next tick,
      // as Node reports the rest: run in the main process (the agent host
      // down), they would otherwise reach the HostedProcess before
      // spawnProcess has returned it, with nobody listening yet.
      const error = serializeError(e);
      process.nextTick(() => {
        post({ type: 'error', id, error });
        post({ type: 'close', id });
      });
      return;
    }
    const launchMs = now() - startedAt;
    children.set(id, child);
    if (typeof child.pid === 'number') post({ type: 'spawned', id, pid: child.pid, launchMs });
    for (const name of ['stdout', 'stderr'] as const) {
      const stream = child[name];
      if (!stream) {
        post({ type: `${name}-end`, id });
        continue;
      }
      stream.setEncoding('utf8');
      stream.on('data', (data: string) => post({ type: name, id, data }));
      stream.on('end', () => post({ type: `${name}-end`, id }));
    }
    // Writing to a process that has exited fails here, not in the caller.
    child.stdin?.on('error', (e) => post({ type: 'stdin-error', id, error: serializeError(e) }));
    child.on('error', (e) => post({ type: 'error', id, error: serializeError(e) }));
    child.on('exit', (code, signal) => {
      // That cmd.exe is reported as Node reports a program that isn't there
      // (and cross-spawn's own spawn does): ENOENT, with no exit. Callers
      // can tell "not installed" from a failure, on Windows too.
      if (notFound && code === 1) post({ type: 'error', id, error: serializeError(notFoundError(file)) });
      else post({ type: 'exit', id, code, signal });
    });
    child.on('close', () => {
      children.delete(id);
      post({ type: 'close', id });
    });
  }

  return {
    handle(request) {
      if (request.type === 'spawn') {
        start(request);
        return;
      }
      const child = children.get(request.id);
      if (!child) return;
      try {
        switch (request.type) {
          case 'stdin': child.stdin?.write(request.data); break;
          case 'stdin-end': child.stdin?.end(); break;
          case 'kill': child.kill(request.signal as NodeJS.Signals); break;
        }
      } catch { /* it has already gone */ }
    },
  };
}

/** The error Node's spawn gives for a program that isn't there. */
function notFoundError(file: string): Error {
  return Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT', syscall: `spawn ${file}`, path: file });
}
