import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── child_process mock ───

class FakeChild extends EventEmitter {
  pid = 4321;
  stdinWrites: string[] = [];
  stdin = {
    writable: true,
    write: (data: string) => {
      this.stdinWrites.push(data);
      return true;
    },
    end: vi.fn(),
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let fakeChild: FakeChild;
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { AcpConnection, AcpRequestError, AsyncEventQueue } from './acp-client.js';

function makeConnection(overrides: Partial<ConstructorParameters<typeof AcpConnection>[0]> = {}) {
  const onNotification = vi.fn();
  const onRequest = vi.fn(async (_method: string, _params: unknown): Promise<unknown> => ({ ok: true }));
  const onStderr = vi.fn();
  const onExit = vi.fn();
  const conn = new AcpConnection({
    command: 'fake-agent',
    onNotification,
    onRequest,
    onStderr,
    onExit,
    ...overrides,
  });
  return { conn, onNotification, onRequest, onStderr, onExit };
}

/** Deliver agent stdout to the client, as the child process would. */
function receive(text: string) {
  fakeChild.stdout.emit('data', Buffer.from(text, 'utf8'));
}

/** Parse everything the client wrote to the agent's stdin. */
function sentMessages(): any[] {
  return fakeChild.stdinWrites.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeChild = new FakeChild();
  mockSpawn.mockReturnValue(fakeChild);
});

// ─── AcpConnection ───

describe('AcpConnection', () => {
  it('sends newline-delimited JSON-RPC requests with incrementing ids', () => {
    const { conn } = makeConnection();
    conn.request('initialize', { protocolVersion: 1 });
    conn.request('session/new', { cwd: '/repo' });

    const sent = sentMessages();
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
      { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/repo' } },
    ]);
    expect(fakeChild.stdinWrites.every((w) => w.endsWith('\n'))).toBe(true);
  });

  it('resolves a request with the matching response result', async () => {
    const { conn } = makeConnection();
    const promise = conn.request<{ sessionId: string }>('session/new', { cwd: '/repo' });
    receive('{"jsonrpc":"2.0","id":1,"result":{"sessionId":"abc"}}\n');
    await expect(promise).resolves.toEqual({ sessionId: 'abc' });
  });

  it('rejects a request on a JSON-RPC error response', async () => {
    const { conn } = makeConnection();
    const promise = conn.request('session/load', {});
    receive('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"not found"}}\n');
    await expect(promise).rejects.toMatchObject({ name: 'AcpRequestError', code: -32601, message: 'not found' });
    await expect(promise).rejects.toBeInstanceOf(AcpRequestError);
  });

  it('reassembles messages split across stdout chunks', async () => {
    const { conn } = makeConnection();
    const promise = conn.request('initialize', {});
    receive('{"jsonrpc":"2.0","id":1,');
    receive('"result":{"protocolVersion":1}}\n');
    await expect(promise).resolves.toEqual({ protocolVersion: 1 });
  });

  it('dispatches notifications from the agent', () => {
    const { onNotification } = makeConnection();
    receive('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s"}}\n');
    expect(onNotification).toHaveBeenCalledWith('session/update', { sessionId: 's' });
  });

  it('answers agent requests with the handler result', async () => {
    const { onRequest } = makeConnection();
    onRequest.mockResolvedValue({ outcome: { outcome: 'selected', optionId: 'allow' } });
    receive('{"jsonrpc":"2.0","id":77,"method":"session/request_permission","params":{}}\n');
    await flushMicrotasks();

    expect(onRequest).toHaveBeenCalledWith('session/request_permission', {});
    expect(sentMessages()).toEqual([
      { jsonrpc: '2.0', id: 77, result: { outcome: { outcome: 'selected', optionId: 'allow' } } },
    ]);
  });

  it('answers agent requests with an error when the handler throws', async () => {
    const { onRequest } = makeConnection();
    onRequest.mockRejectedValue(new Error('unsupported'));
    receive('{"jsonrpc":"2.0","id":9,"method":"fs/read_text_file","params":{}}\n');
    await flushMicrotasks();

    expect(sentMessages()).toEqual([
      { jsonrpc: '2.0', id: 9, error: { code: -32603, message: 'unsupported' } },
    ]);
  });

  it('routes non-JSON stdout lines to the stderr handler', () => {
    const { onStderr, onNotification } = makeConnection();
    receive('starting vibe...\n');
    expect(onStderr).toHaveBeenCalledWith('starting vibe...\n');
    expect(onNotification).not.toHaveBeenCalled();
  });

  it('rejects pending requests and reports exit when the process dies', async () => {
    const { conn, onExit } = makeConnection();
    const promise = conn.request('session/prompt', {});
    fakeChild.emit('exit', 1);
    await expect(promise).rejects.toThrow(/exited/);
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it('sends notifications without an id', () => {
    const { conn } = makeConnection();
    conn.notify('session/cancel', { sessionId: 's' });
    expect(sentMessages()).toEqual([
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } },
    ]);
  });

  it('close() kills the child and rejects pending requests', async () => {
    const { conn } = makeConnection();
    const promise = conn.request('session/prompt', {});
    conn.close();
    await expect(promise).rejects.toThrow(/closed/);
    expect(fakeChild.kill).toHaveBeenCalled();
  });
});

// ─── AsyncEventQueue ───

describe('AsyncEventQueue', () => {
  it('delivers values pushed before and after a consumer waits', async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);

    const results: number[] = [];
    const consumer = (async () => {
      for await (const v of queue) results.push(v);
    })();

    queue.push(2);
    await flushMicrotasks();
    queue.push(3);
    queue.end();
    await consumer;

    expect(results).toEqual([1, 2, 3]);
  });

  it('end() terminates a waiting consumer', async () => {
    const queue = new AsyncEventQueue<number>();
    const consumer = (async () => {
      const collected: number[] = [];
      for await (const v of queue) collected.push(v);
      return collected;
    })();
    queue.end();
    await expect(consumer).resolves.toEqual([]);
  });

  it('ignores pushes after end()', async () => {
    const queue = new AsyncEventQueue<number>();
    queue.end();
    queue.push(42);
    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
