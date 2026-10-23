/**
 * JSON-RPC 2.0 over newline-delimited streams: ACP's stdio transport. Each
 * message is one line of UTF-8 JSON. Both sides send requests, so this
 * matches responses to our requests and answers the agent's.
 * https://agentclientprotocol.com/protocol/transports
 */
import type { Readable, Writable } from 'node:stream';

/** An error with a JSON-RPC code: thrown by a request handler to answer the
 *  agent with that code, and rejected from request() when the agent answers
 *  with an error. */
export class JsonRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export const RPC_ERRORS = {
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** ACP: the agent needs the user to sign in first. */
  authRequired: -32000,
  /** ACP: no such session (or other resource). */
  resourceNotFound: -32002,
} as const;

export interface RpcHandlers {
  /** Answer a request from the other side. Throw JsonRpcError to answer
   *  with that code; any other error answers "internal error". */
  onRequest(method: string, params: unknown): Promise<unknown>;
  onNotification(method: string, params: unknown): void;
  /** A line that isn't a JSON-RPC message (agents should never write one). */
  onBadLine?(line: string): void;
}

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };

export class JsonRpcConnection {
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private buffer = '';
  private closedWith: Error | null = null;

  constructor(
    input: Readable,
    private readonly output: Writable,
    private readonly handlers: RpcHandlers,
  ) {
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => this.receive(chunk));
    input.on('end', () => this.close(new Error('The agent closed its output')));
    input.on('error', (err) => this.close(err));
  }

  /** Send a request and wait for its result. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closedWith) return;
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /** Fail every request still waiting; later calls reject at once. */
  close(reason: Error = new Error('Connection closed')): void {
    if (this.closedWith) return;
    this.closedWith = reason;
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  private write(message: object): void {
    // JSON.stringify escapes newlines inside strings, so one message is one line.
    try {
      this.output.write(`${JSON.stringify(message)}\n`);
    } catch (e) {
      this.close(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      this.handlers.onBadLine?.(line);
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      this.handlers.onBadLine?.(line);
      return;
    }
    const hasId = msg.id !== undefined && msg.id !== null;
    if (typeof msg.method === 'string') {
      if (hasId) void this.answer(msg.id, msg.method, msg.params);
      else this.handlers.onNotification(msg.method, msg.params);
      return;
    }
    if (hasId) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new JsonRpcError(Number(msg.error.code) || RPC_ERRORS.internal, String(msg.error.message ?? 'Agent error'), msg.error.data));
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.onRequest(method, params);
      this.write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (e) {
      const err = e instanceof JsonRpcError ? e : new JsonRpcError(RPC_ERRORS.internal, e instanceof Error ? e.message : String(e));
      this.write({ jsonrpc: '2.0', id, error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } });
    }
  }
}
