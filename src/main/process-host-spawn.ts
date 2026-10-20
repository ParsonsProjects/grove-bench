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
   *  never started): end it here too. */
  lost(): void {
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

  function start({ id, file, args, cwd, env, findCommand }: SpawnRequest): void {
    const startedAt = now();
    let child: ChildProcess;
    try {
      const options: SpawnOptions = { cwd, env, stdio: 'pipe', windowsHide: true };
      // cross-spawn's parse finds the command and wraps a .cmd shim in
      // cmd.exe, as execa does before it spawns. It reads the disk, which is
      // why it runs here and not on the main process.
      const launch = findCommand ? crossSpawn._parse(file, args, options) : { command: file, args, options };
      child = spawn(launch.command, launch.args, launch.options);
    } catch (e) {
      post({ type: 'error', id, error: serializeError(e) });
      post({ type: 'close', id });
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
    child.on('exit', (code, signal) => post({ type: 'exit', id, code, signal }));
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
