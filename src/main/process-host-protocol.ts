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
  timeout?: number;
  reject?: boolean;
  input?: string;
  encoding?: 'utf8' | 'buffer';
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

const RESULT_FIELDS = [
  'stdout', 'stderr', 'exitCode', 'failed', 'timedOut', 'isCanceled', 'isTerminated', 'isMaxBuffer',
  'signal', 'signalDescription', 'command', 'escapedCommand', 'cwd', 'durationMs',
] as const;

const ERROR_FIELDS = ['name', 'message', 'stack', 'shortMessage', 'originalMessage', 'code'] as const;

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
  return { ...pick(source, RESULT_FIELDS), ...pick(source, ERROR_FIELDS), name: error.name, message: error.message } as SerializedError;
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
