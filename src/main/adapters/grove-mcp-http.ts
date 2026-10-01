/**
 * Grove's tool servers (grove-tools.ts) over MCP's Streamable HTTP transport,
 * for agents that connect to MCP servers by address rather than taking
 * in-process SDK servers the way Claude Code does (ACP agents, which get
 * them in `session/new`).
 *
 * One local HTTP server per agent query, on 127.0.0.1 and a free port, with
 * each Grove server at `/mcp/<name>`. Every request must carry the bearer
 * token made for that query, and Host must name the loopback address, so
 * other local processes and web pages (DNS rebinding) can't reach the
 * user's memory or Preview browser. Stateless: each request gets its own
 * MCP server and transport, so an agent that reconnects just works.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { GroveServer, GroveServerName } from './grove-tools.js';
import { logger } from '../logger.js';

export interface GroveMcpEndpoint {
  name: GroveServerName;
  url: string;
  /** Headers the agent must send, as ACP's HttpHeader list. */
  headers: Array<{ name: string; value: string }>;
}

export interface GroveMcpHttp {
  endpoints: GroveMcpEndpoint[];
  close(): Promise<void>;
}

function mcpServerFor(def: GroveServer): McpServer {
  const server = new McpServer(
    { name: def.name, version: '1.0.0' },
    def.instructions ? { instructions: def.instructions } : undefined,
  );
  for (const tool of def.tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape, annotations: tool.annotations },
      // The MCP layer has validated args against the shape.
      async (args: unknown) => tool.run(args ?? {}),
    );
  }
  return server;
}

/** Start serving `servers`. Resolves once the port is open. */
export async function startGroveMcpHttp(servers: GroveServer[]): Promise<GroveMcpHttp> {
  const token = crypto.randomBytes(32).toString('base64url');
  const byName = new Map(servers.map((s) => [s.name, s]));
  let port = 0;

  const httpServer = http.createServer((req, res) => {
    void handle(req, res).catch((e) => {
      logger.warn('[grove-mcp-http] request failed:', e);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    const name = /^\/mcp\/([a-z-]+)\/?$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname)?.[1];
    const def = name ? byName.get(name as GroveServerName) : undefined;
    if (!def) {
      res.writeHead(404).end();
      return;
    }
    const server = mcpServerFor(def);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  port = (httpServer.address() as AddressInfo).port;

  return {
    endpoints: servers.map((s) => ({
      name: s.name,
      url: `http://127.0.0.1:${port}/mcp/${s.name}`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    })),
    close: () => new Promise<void>((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    }),
  };
}
