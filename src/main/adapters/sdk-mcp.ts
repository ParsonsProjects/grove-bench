/**
 * Grove's tool servers (grove-tools.ts) as in-process Claude Agent SDK MCP
 * servers. Claude Code adapter-specific.
 */
import type { GroveServer } from './grove-tools.js';

// ─── SDK dynamic import (ESM-only module in a CJS Electron main process) ───

const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer;
let _tool: typeof import('@anthropic-ai/claude-agent-sdk').tool;

async function ensureSdk() {
  if (!_createSdkMcpServer) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _createSdkMcpServer = sdk.createSdkMcpServer;
    _tool = sdk.tool;
  }
}

export async function toSdkMcpServer(server: GroveServer) {
  await ensureSdk();
  return _createSdkMcpServer({
    name: server.name,
    ...(server.instructions ? { instructions: server.instructions } : {}),
    ...(server.alwaysLoad ? { alwaysLoad: true } : {}),
    tools: server.tools.map((t) => _tool(
      t.name,
      t.description,
      t.shape,
      t.run,
      { ...(t.searchHint ? { searchHint: t.searchHint } : {}), annotations: t.annotations },
    )),
  });
}
