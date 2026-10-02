import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBridge, sseMessages } from './bridge.mjs';
import { startGroveMcpHttp, type GroveMcpHttp } from '../grove-mcp-http.js';
import { memoryServer } from '../grove-tools.js';
import type { MemoryOperations } from '../types.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.mjs');

function fakeMemory(): MemoryOperations {
  const files = new Map<string, string>([['repo/overview.md', '# Overview']]);
  return {
    list: () => [...files.keys()].map((p) => ({ path: p }) as any),
    read: (p) => files.get(p) ?? null,
    write: (p, c) => { files.set(p, c); },
    delete: (p) => files.delete(p),
  };
}

let server: GroveMcpHttp | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const READ = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_read', arguments: { path: 'repo/overview.md' } } };

/** Send `messages` through runBridge and collect what comes back. */
async function exchange(opts: { url: string; authorization: string; fetchImpl?: typeof fetch }, messages: object[]): Promise<any[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies: any[] = [];
  output.on('data', (b: Buffer) => b.toString().split('\n').filter(Boolean).forEach((l) => replies.push(JSON.parse(l))));
  const done = runBridge({ input, output, ...opts });
  for (const m of messages) input.write(`${JSON.stringify(m)}\n`);
  input.end();
  await done;
  return replies;
}

describe('runBridge', () => {
  it('carries an MCP session to Grove\'s server and back', async () => {
    server = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    const { url, headers } = server.endpoints[0];
    const replies = await exchange({ url, authorization: headers[0].value }, [INIT, INITIALIZED, LIST, READ]);

    // The notification gets no reply; the three requests do.
    expect(replies.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect(replies.find((r) => r.id === 1).result.serverInfo.name).toBe('grove-memory');
    expect(replies.find((r) => r.id === 2).result.tools.map((t: { name: string }) => t.name)).toContain('memory_read');
    expect(replies.find((r) => r.id === 3).result.content).toEqual([{ type: 'text', text: '# Overview' }]);
  });

  it('sends the agreed protocol version on requests after initialize', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      const body = JSON.parse(String(init?.body));
      if (!('id' in body)) return new Response(null, { status: 202 });
      const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18' } : {};
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await exchange({ url: 'http://127.0.0.1:1/mcp/x', authorization: 'Bearer t', fetchImpl }, [INIT, INITIALIZED, LIST]);
    expect(seen[0]['mcp-protocol-version']).toBeUndefined();
    expect(seen[1]['mcp-protocol-version']).toBe('2025-06-18');
    expect(seen[2]['mcp-protocol-version']).toBe('2025-06-18');
    expect(seen.every((h) => h.authorization === 'Bearer t')).toBe(true);
  });

  it('answers requests with an error when Grove can\'t be reached or refuses', async () => {
    server = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    const refused = await exchange({ url: server.endpoints[0].url, authorization: 'Bearer wrong' }, [INIT, INITIALIZED]);
    expect(refused).toEqual([{ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Grove Bench answered HTTP 401' } }]);

    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const unreachable = await exchange({ url: 'http://127.0.0.1:1/mcp/x', authorization: 'Bearer t', fetchImpl }, [LIST]);
    expect(unreachable[0]).toMatchObject({ id: 2, error: { code: -32603, message: expect.stringContaining('not reachable (ECONNREFUSED)') } });
  });

  it('answers with an error when a reply is cut off, and keeps running', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.id === 2) {
        return { status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: () => Promise.reject(new Error('socket hang up')) } as unknown as Response;
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const replies = await exchange({ url: 'http://127.0.0.1:1/mcp/x', authorization: 'Bearer t', fetchImpl }, [LIST, READ]);
    expect(replies.find((r) => r.id === 2)).toMatchObject({ error: { code: -32603, message: expect.stringContaining('cut off (socket hang up)') } });
    expect(replies.find((r) => r.id === 3)).toMatchObject({ result: {} });
  });

  it('reads replies sent as server-sent events', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,\ndata: "result":{}}\n\nevent: ping\ndata: not json\n\n';
    expect(sseMessages(body)).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });
});

describe('the bridge program', () => {
  it('runs from the environment it is started with', async () => {
    server = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    const { url, headers } = server.endpoints[0];
    const child = spawn(process.execPath, [MAIN], {
      env: { ...process.env, GROVE_MCP_URL: url, GROVE_MCP_AUTHORIZATION: headers[0].value },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    for (const m of [INIT, INITIALIZED, READ]) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);
    const replies = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(replies.find((r) => r.id === 3).result.content[0].text).toBe('# Overview');
  });

  it('refuses to start without its settings', async () => {
    const env = { ...process.env };
    delete env.GROVE_MCP_URL;
    delete env.GROVE_MCP_AUTHORIZATION;
    const child = spawn(process.execPath, [MAIN], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(2);
    expect(err).toContain('GROVE_MCP_URL');
  });
});
