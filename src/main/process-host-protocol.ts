/**
 * What the main process and the process host (process-host.ts,
 * process-host-child.ts) send each other: a command to run, and what it
 * printed or how it failed. Both sides import this file, so it uses only
 * Node; nothing here may touch Electron's `app`, which a utility process
 * doesn't have.
 */

/** The execa options a hosted command may use. Each is plain data, so it
 *  survives being posted to another process. */
export interface HostedOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** false: `env` is the whole environment, rather than added to the one
   *  the command would inherit. For an environment with variables taken out
   *  (accountEnv), which would otherwise come back. */
  extendEnv?: boolean;
  /** Run the command line in cmd.exe (/bin/sh elsewhere), as Node's
   *  `shell: true` does: `file` and `args` joined with spaces, unquoted, so
   *  the caller quotes them. */
  shell?: boolean;
  timeout?: number;
  /** Fail, with `isMaxBuffer` set, once the command writes more than this
   *  (characters, or bytes with `encoding: 'buffer'`). execa then closes
   *  the command's output, so it ends when it next writes. */
  maxBuffer?: number;
  reject?: boolean;
  input?: string;
  encoding?: 'utf8' | 'buffer';
  /** Safe to run again: it only reads, or doing it twice does no harm
   *  (taskkill). runProcess runs it again when the host fails it: in the
   *  restarted host if it died (or in the main process, as a command
   *  waiting for it would), in the main process if it stopped answering or
   *  stopped at quit; runInAgentHost starts it again when the agent host
   *  dies. Not an execa option: the main process keeps it, and never sends
   *  it. */
  idempotent?: boolean;
  /** Can't wait for the host: when it isn't up (starting, or restarting
   *  after a crash or a kill) or dies under it, runProcess runs it in the
   *  main process at once, as before the host, rather than wait up to
   *  HOST_WAIT_MS. For killing a process tree (taskkill): the agent keeps
   *  running until it is, and a quit has only so long. Not an execa option
   *  either: the main process keeps it, and never sends it. */
  urgent?: boolean;
}

/** The fields of an execa result (or error) that callers read. */
export interface ProcessResult<T extends string | Uint8Array = string> {
  stdout: T;
  stderr: T;
  exitCode?: number;
  failed: boolean;
  timedOut: boolean;
  isCanceled?: boolean;
  isTerminated?: boolean;
  isMaxBuffer?: boolean;
  signal?: string;
  signalDescription?: string;
  command?: string;
  escapedCommand?: string;
  cwd?: string;
  durationMs?: number;
}

/** An execa error as data: its message and stack, and every result field. */
export interface SerializedError extends Partial<ProcessResult<string | Uint8Array>> {
  name: string;
  message: string;
  stack?: string;
  shortMessage?: string;
  originalMessage?: string;
  /** A Node error code, such as ENOENT when git isn't installed. */
  code?: string;
  syscall?: string;
  path?: string;
  errno?: number;
}

export interface HostRequest {
  id: number;
  file: string;
  args: string[];
  options?: HostedOptions;
}

export type HostReply =
  | { id: number; ok: true; result: ProcessResult<string | Uint8Array>; launchMs: number }
  | { id: number; ok: false; error: SerializedError; launchMs: number };

/** Posted as soon as a command's process exists, so the main process can
 *  stop it if the host dies first (an orphan would otherwise keep running,
 *  its execa timeout gone with the host). */
export interface HostStarted {
  type: 'started';
  id: number;
  pid: number;
}

/** The first message the host posts, once it can take requests. */
export const HOST_READY = 'grove-process-host-ready';

/**
 * Start a long-running process whose output streams back as it comes (an
 * agent's program), rather than a command that is waited for. Its input, and
 * a request to stop it, follow as StdioRequests with the same id.
 */
export interface SpawnRequest {
  type: 'spawn';
  id: number;
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** `file` is a command name to find as a shell would (PATH, and PATHEXT on
   *  Windows), running a .cmd or .bat through cmd.exe with its arguments
   *  escaped, as execa does (cross-spawn). npm installs command-line agents
   *  as .cmd shims, which Node's spawn can't start on its own. */
  findCommand?: boolean;
  /** 'ignore': the process's standard output is thrown away where it runs,
   *  never sent (npm install's progress, which nobody reads). Its stderr
   *  still comes. 'pipe' (the default) sends it. */
  stdout?: 'pipe' | 'ignore';
  /** Run the command line in cmd.exe (/bin/sh elsewhere), as execa's
   *  `shell: true` does: `file` and `args` joined with spaces, unquoted, so
   *  the caller quotes them. */
  shell?: boolean;
}

export type StdioRequest =
  | { type: 'stdin'; id: number; data: string | Uint8Array }
  | { type: 'stdin-end'; id: number }
  | { type: 'kill'; id: number; signal: string };

/** What a spawned process did, in the order it did it. Output is text:
 *  the host decodes it as UTF-8, so no character is split between two
 *  messages. `close` comes last, once the process has exited and its output
 *  has ended. */
export type SpawnEvent =
  | { type: 'spawned'; id: number; pid: number; launchMs: number }
  | { type: 'stdout' | 'stderr'; id: number; data: string }
  | { type: 'stdout-end' | 'stderr-end'; id: number }
  | { type: 'stdin-error' | 'error'; id: number; error: SerializedError }
  | { type: 'exit'; id: number; code: number | null; signal: string | null }
  | { type: 'close'; id: number };

const SPAWN_EVENT_TYPES = new Set(['spawned', 'stdout', 'stderr', 'stdout-end', 'stderr-end', 'stdin-error', 'error', 'exit', 'close']);
const STDIO_REQUEST_TYPES = new Set(['stdin', 'stdin-end', 'kill']);

const RESULT_FIELDS = [
  'stdout', 'stderr', 'exitCode', 'failed', 'timedOut', 'isCanceled', 'isTerminated', 'isMaxBuffer',
  'signal', 'signalDescription', 'command', 'escapedCommand', 'cwd', 'durationMs',
] as const;

// syscall, path and errno: a failed spawn names the call and the file, and
// the agent SDK reads `syscall` to tell a failed start from a crash.
const ERROR_FIELDS = ['name', 'message', 'stack', 'shortMessage', 'originalMessage', 'code', 'syscall', 'path', 'errno'] as const;

/** Copy the listed fields that hold a string, number, boolean or bytes. */
function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Uint8Array) {
      out[field] = value;
    }
  }
  return out;
}

/** The result fields of an execa result, as plain data. */
export function serializeResult(result: unknown): ProcessResult<string | Uint8Array> {
  const picked = pick((result ?? {}) as Record<string, unknown>, RESULT_FIELDS);
  return { stdout: '', stderr: '', failed: false, timedOut: false, ...picked } as ProcessResult<string | Uint8Array>;
}

/** An error (execa's or any other) as plain data. */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const source = error as unknown as Record<string, unknown>;
  const data = { ...pick(source, RESULT_FIELDS), ...pick(source, ERROR_FIELDS), name: error.name, message: error.message } as SerializedError;
  // Past maxBuffer, execa's error holds the output it read, up to the
  // limit, three times: in stdout, and again in message and stack. The
  // caller set the limit because it didn't want that much, so none of it
  // is sent.
  if (data.isMaxBuffer) {
    delete data.stdout;
    delete data.stderr;
    delete data.stack;
    data.message = data.shortMessage ?? 'Output over maxBuffer';
  }
  return data;
}

/** An Error carrying the fields the host sent, so callers can read
 *  `stderr`, `exitCode` or `code` just as they would on execa's own. */
export function reviveError(data: SerializedError): Error {
  const error = new Error(data.message);
  Object.assign(error, data);
  return error;
}

/** execa, or a stand-in: the running command, with its process id once
 *  the OS has created it. */
export type Exec = (file: string, args: string[], options?: HostedOptions) => Promise<unknown> & { pid?: number };

/**
 * Run one request with `exec` (execa) and say how it went. `launchMs` is how
 * long the call held this process before it started waiting: execa's PATH
 * search plus the OS creating the process. `onStarted` gets the process id
 * as soon as there is one.
 */
export async function runRequest(
  request: HostRequest,
  exec: Exec,
  now: () => number = () => performance.now(),
  onStarted?: (pid: number) => void,
): Promise<HostReply> {
  const start = now();
  let launchMs: number | null = null;
  try {
    const running = request.options === undefined
      ? exec(request.file, request.args)
      : exec(request.file, request.args, request.options);
    launchMs = now() - start;
    if (typeof running.pid === 'number') onStarted?.(running.pid);
    return { id: request.id, ok: true, result: serializeResult(await running), launchMs };
  } catch (e) {
    return { id: request.id, ok: false, error: serializeError(e), launchMs: launchMs ?? now() - start };
  }
}

/** Whether `value` is a request the host can run. */
export function isHostRequest(value: unknown): value is HostRequest {
  const r = value as Partial<HostRequest> | null;
  return !!r && typeof r === 'object'
    // Spawn and stdio requests carry a type; a command to run has none.
    && !('type' in r)
    && typeof r.id === 'number'
    && typeof r.file === 'string'
    && Array.isArray(r.args) && r.args.every((a) => typeof a === 'string')
    && (r.options === undefined || (typeof r.options === 'object' && r.options !== null));
}

/** Whether `value` says a command's process has started. */
export function isHostStarted(value: unknown): value is HostStarted {
  const r = value as Partial<HostStarted> | null;
  return !!r && typeof r === 'object' && r.type === 'started' && typeof r.id === 'number' && typeof r.pid === 'number';
}

/** Whether `value` is a reply from the host. */
export function isHostReply(value: unknown): value is HostReply {
  const r = value as Partial<HostReply> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'number' || typeof r.launchMs !== 'number') return false;
  return r.ok === true ? typeof r.result === 'object' && r.result !== null
    : r.ok === false && typeof r.error === 'object' && r.error !== null;
}

/** Whether `value` asks the host to start a long-running process. */
export function isSpawnRequest(value: unknown): value is SpawnRequest {
  const r = value as Partial<SpawnRequest> | null;
  return !!r && typeof r === 'object' && r.type === 'spawn'
    && typeof r.id === 'number'
    && typeof r.file === 'string'
    && Array.isArray(r.args) && r.args.every((a) => typeof a === 'string')
    && (r.cwd === undefined || typeof r.cwd === 'string')
    && (r.env === undefined || (typeof r.env === 'object' && r.env !== null))
    && (r.findCommand === undefined || typeof r.findCommand === 'boolean')
    && (r.stdout === undefined || r.stdout === 'pipe' || r.stdout === 'ignore')
    && (r.shell === undefined || typeof r.shell === 'boolean');
}

/** Whether `value` is input for, or a request to stop, a spawned process. */
export function isStdioRequest(value: unknown): value is StdioRequest {
  const r = value as { type?: unknown; id?: unknown } | null;
  return !!r && typeof r === 'object' && typeof r.type === 'string' && STDIO_REQUEST_TYPES.has(r.type) && typeof r.id === 'number';
}

/** Whether `value` reports what a spawned process did. */
export function isSpawnEvent(value: unknown): value is SpawnEvent {
  const r = value as { type?: unknown; id?: unknown } | null;
  return !!r && typeof r === 'object' && typeof r.type === 'string' && SPAWN_EVENT_TYPES.has(r.type) && typeof r.id === 'number';
}
