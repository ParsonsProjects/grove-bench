/**
 * Grove's tool servers as Claude Code gets them (sdk-mcp.ts): built by the
 * real Claude Agent SDK, imported as Vitest can (claude-sdk.ts mocked), and
 * read back by an MCP client over an in-memory pair of transports.
 */
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('./claude-sdk.js', () => ({ loadClaudeSdk: () => import('@anthropic-ai/claude-agent-sdk') }));

import { createMemoryMcpServer } from './memory-mcp-server.js';
import { claudePreviewServer, createPreviewMcpServer } from './preview-mcp-server.js';
import { memoryServer, type GroveServer } from './grove-tools.js';
import type { MemoryOperations, PreviewOperations } from './types.js';

/** What createSdkMcpServer returns, as far as these tests read it. */
interface SdkServer {
  type: string;
  name: string;
  instance: { connect(transport: unknown): Promise<void> };
}

/** An MCP client on a server the SDK built. */
async function connect(server: SdkServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

function memoryOps(): MemoryOperations {
  return {
    list: vi.fn(() => []),
    read: vi.fn((path: string) => (path === 'repo/overview.md' ? '# Overview' : null)),
    write: vi.fn(),
    delete: vi.fn(() => true),
  };
}

function previewOps(): PreviewOperations {
  return {
    open: vi.fn(() => Promise.resolve('Opened http://localhost:5173/')),
    screenshot: vi.fn(),
    read: vi.fn(),
    logs: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
  };
}

/** Each tool as the agent would see it, from the server's own definition. */
function expectedTools(server: GroveServer) {
  return server.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputs: Object.keys(t.shape).sort(),
    annotations: t.annotations,
    searchHint: t.searchHint,
    alwaysLoad: server.alwaysLoad,
  }));
}

/** The same, from what the client was served. */
async function servedTools(client: Client) {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputs: Object.keys(t.inputSchema.properties ?? {}).sort(),
    annotations: t.annotations,
    searchHint: t._meta?.['anthropic/searchHint'],
    alwaysLoad: t._meta?.['anthropic/alwaysLoad'],
  }));
}

describe('toSdkMcpServer: Grove\'s tool servers as the SDK serves them', () => {
  it('serves the Preview tools as grove-tools.ts defines them, loaded up front, with Claude Code\'s instructions', async () => {
    const ops = previewOps();
    const server = await createPreviewMcpServer(ops) as unknown as SdkServer;
    expect(server).toMatchObject({ type: 'sdk', name: 'grove-preview' });
    const client = await connect(server);
    const ours = claudePreviewServer(ops);
    expect(client.getInstructions()).toBe(ours.instructions);
    expect(await servedTools(client)).toEqual(expectedTools(ours));
  });

  it('serves the memory tools as grove-tools.ts defines them, behind tool search, with no instructions', async () => {
    const ops = memoryOps();
    const server = await createMemoryMcpServer(ops) as unknown as SdkServer;
    expect(server).toMatchObject({ type: 'sdk', name: 'grove-memory' });
    const client = await connect(server);
    expect(client.getInstructions()).toBeUndefined();
    expect(await servedTools(client)).toEqual(expectedTools(memoryServer(ops)));
  });

  it("runs a tool with the agent's arguments, on the thread's own operations", async () => {
    const ops = memoryOps();
    const client = await connect(await createMemoryMcpServer(ops));

    expect(await client.callTool({ name: 'memory_write', arguments: { path: 'sessions/plan.md', content: '# Plan' } }))
      .toMatchObject({ content: [{ type: 'text', text: 'Written: sessions/plan.md' }] });
    expect(ops.write).toHaveBeenCalledWith('sessions/plan.md', '# Plan');

    expect(await client.callTool({ name: 'memory_read', arguments: { path: 'repo/overview.md' } }))
      .toMatchObject({ content: [{ type: 'text', text: '# Overview' }] });
    expect(await client.callTool({ name: 'memory_read', arguments: { path: 'repo/missing.md' } }))
      .toMatchObject({ isError: true, content: [{ type: 'text', text: 'File not found: repo/missing.md' }] });
  });
});
