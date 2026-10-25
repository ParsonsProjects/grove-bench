import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { JsonRpcConnection, JsonRpcError, RPC_ERRORS, type RpcHandlers } from './rpc.js';

/** A connection whose agent side is two streams: `send` writes a line as the
 *  agent, `sent` reads what the connection wrote back. */
function connect(handlers: Partial<RpcHandlers> = {}) {
  const fromAgent = new PassThrough();
  const toAgent = new PassThrough();
  const sent: unknown[] = [];
  toAgent.setEncoding('utf8');
  toAgent.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line) sent.push(JSON.parse(line));
  });
  const all: RpcHandlers = {
    onRequest: vi.fn(() => Promise.resolve('ok')),
    onNotification: vi.fn(),
    onBadLine: vi.fn(),
    ...handlers,
  };
  const rpc = new JsonRpcConnection(fromAgent, toAgent, all);
  const send = (message: unknown) => fromAgent.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  return { rpc, send, sent, handlers: all };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('JsonRpcConnection', () => {
  it('matches a response to its request', async () => {
    const { rpc, send, sent } = connect();
    const result = rpc.request('session/new', { cwd: '/x' });
    await settle();
    expect(sent).toEqual([{ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/x' } }]);
    send({ jsonrpc: '2.0', id: 1, result: { sessionId: 's1' } });
    await expect(result).resolves.toEqual({ sessionId: 's1' });
  });

  it("rejects a request the agent answers with an error, keeping its code", async () => {
    const { rpc, send } = connect();
    const result = rpc.request('session/load');
    send({ jsonrpc: '2.0', id: 1, error: { code: RPC_ERRORS.resourceNotFound, message: 'No such session' } });
    await expect(result).rejects.toEqual(new JsonRpcError(RPC_ERRORS.resourceNotFound, 'No such session'));
  });

  it('answers an error that is not an object as an internal error', async () => {
    const { rpc, send } = connect();
    const result = rpc.request('x');
    send({ jsonrpc: '2.0', id: 1, error: 'broken' });
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect(err).toMatchObject({ code: RPC_ERRORS.internal, message: 'Agent error' });
  });

  it("answers the agent's request, and passes on its notifications", async () => {
    const { send, sent, handlers } = connect();
    send({ jsonrpc: '2.0', id: 'a', method: 'fs/read_text_file', params: { path: 'f' } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { update: 1 } });
    await settle();
    expect(handlers.onRequest).toHaveBeenCalledWith('fs/read_text_file', { path: 'f' });
    expect(handlers.onNotification).toHaveBeenCalledWith('session/update', { update: 1 });
    expect(sent).toEqual([{ jsonrpc: '2.0', id: 'a', result: 'ok' }]);
  });

  it('reports lines that are not JSON-RPC messages, or have an id that is not a string or number', async () => {
    const { send, sent, handlers } = connect();
    send('not json');
    send({ jsonrpc: '1.0', id: 1, method: 'x' });
    send({ jsonrpc: '2.0', id: { n: 1 }, method: 'x' });
    await settle();
    expect(handlers.onBadLine).toHaveBeenCalledTimes(3);
    expect(handlers.onRequest).not.toHaveBeenCalled();
    expect(handlers.onNotification).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
