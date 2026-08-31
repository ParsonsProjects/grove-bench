/**
 * Minimal Agent Client Protocol (ACP) client.
 *
 * ACP (https://agentclientprotocol.com) is JSON-RPC 2.0 over the agent
 * process's stdio, one JSON message per line. Grove is the *client*; the
 * spawned agent binary (e.g. `vibe-acp`) is the *agent*. This module is
 * provider-agnostic — adapter-specific behavior (event mapping, permission
 * option selection) lives in the adapter that owns the connection.
 *
 * Responsibilities:
 * - spawn the agent process and frame newline-delimited JSON-RPC messages
 * - correlate client→agent requests with their responses
 * - dispatch agent→client requests (e.g. `session/request_permission`) to a
 *   handler and send its result back
 * - dispatch agent→client notifications (e.g. `session/update`)
 */
import { spawn, type ChildProcess } from 'node:child_process';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AcpConnectionOpts {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Agent→client notification (no response expected). */
  onNotification: (method: string, params: unknown) => void;
  /** Agent→client request — the returned value is sent back as the result.
   *  Throwing rejects the request with an internal error. */
  onRequest: (method: string, params: unknown) => Promise<unknown>;
  onStderr?: (data: string) => void;
  /** Process exited (or failed to spawn). Pending requests are rejected first. */
  onExit?: (code: number | null) => void;
}

export class AcpConnection {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private closed = false;

  constructor(private opts: AcpConnectionOpts) {
    this.child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // uv/pip install `vibe-acp` as a .exe shim on Windows, but a shell
      // resolves PATHEXT variants (.cmd/.bat) too, matching how the other
      // adapters invoke provider CLIs.
      shell: process.platform === 'win32',
    });

    this.child.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk.toString('utf8')));
    if (opts.onStderr) {
      this.child.stderr?.on('data', (chunk: Buffer) => opts.onStderr!(chunk.toString('utf8')));
    }
    this.child.on('error', (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    this.child.on('exit', (code) => {
      this.failAll(new Error(`ACP agent process exited (code ${code ?? 'unknown'})`));
      opts.onExit?.(code);
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  private handleStdout(text: string): void {
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        // Not JSON-RPC (stray agent logging on stdout) — surface via stderr handler.
        this.opts.onStderr?.(line + '\n');
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: JsonRpcMessage): void {
    // Response to one of our requests
    if (message.id !== undefined && message.method === undefined) {
      const entry = this.pending.get(message.id as number);
      if (!entry) return;
      this.pending.delete(message.id as number);
      if (message.error) {
        entry.reject(new AcpRequestError(message.error.code, message.error.message, message.error.data));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    // Agent→client request (needs a response)
    if (message.id !== undefined && message.method !== undefined) {
      const id = message.id;
      this.opts.onRequest(message.method, message.params)
        .then((result) => this.send({ jsonrpc: '2.0', id, result: result ?? null }))
        .catch((e) => this.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        }));
      return;
    }

    // Notification
    if (message.method !== undefined) {
      this.opts.onNotification(message.method, message.params);
    }
  }

  private send(message: JsonRpcMessage): void {
    if (this.closed || !this.child.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  /** Send a client→agent request and await its response. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Send a client→agent notification (no response). */
  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private failAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  /** Terminate the agent process. Safe to call more than once. */
  close(): void {
    this.failAll(new Error('ACP connection closed'));
    try { this.child.stdin?.end(); } catch { /* already closed */ }
    try { this.child.kill(); } catch { /* already dead */ }
  }
}

/** JSON-RPC error returned by the agent for one of our requests. */
export class AcpRequestError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'AcpRequestError';
  }
}

/**
 * Unbounded push→pull queue bridging callback-style ACP notifications into
 * the AsyncIterable<AgentEvent> the adapter contract expects.
 */
export class AsyncEventQueue<T> {
  private values: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  /** Signal end of stream — pending and future reads resolve as done. */
  end(): void {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
