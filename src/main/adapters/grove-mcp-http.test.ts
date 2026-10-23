import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startGroveMcpHttp, type GroveMcpHttp } from './grove-mcp-http.js';
import { memoryServer } from './grove-tools.js';
import type { MemoryOperations } from './types.js';

vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

function fakeMemory(): MemoryOperations {
  const files = new Map<string, string>([['repo/overview.md', '# Overview']]);
  return {
    list: () => [...files.keys()].map((path) => ({ path, name: path, description: '', type: 'repo' }) as any),
    read: (p) => files.get(p) ?? null,
    write: (p, c) => { files.set(p, c); },
    delete: (p) => files.delete(p),
  };
}

let running: GroveMcpHttp | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

async function connect(endpoint: GroveMcpHttp['endpoints'][number]) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const headers = Object.fromEntries(endpoint.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers } }));
  return client;
}

describe('startGroveMcpHttp', () => {
  it('serves each Grove server at its own loopback address', async () => {
    running = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    expect(running.endpoints).toHaveLength(1);
    expect(running.endpoints[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/grove-memory$/);

    const client = await connect(running.endpoints[0]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['memory_list', 'memory_read', 'memory_write', 'memory_delete']);

    const result = await client.callTool({ name: 'memory_read', arguments: { path: 'repo/overview.md' } });
    expect(result.content).toEqual([{ type: 'text', text: '# Overview' }]);
    await client.close();
  });

  it('turns away requests without the token', async () => {
    running = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    const res = await fetch(running.endpoints[0].url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('answers 404 for a server it does not serve', async () => {
    running = await startGroveMcpHttp([memoryServer(fakeMemory())]);
    const url = running.endpoints[0].url.replace('grove-memory', 'grove-preview');
    const res = await fetch(url, { method: 'POST', headers: { authorization: running.endpoints[0].headers[0].value } });
    expect(res.status).toBe(404);
  });
});
