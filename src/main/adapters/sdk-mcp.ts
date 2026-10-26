/**
 * Grove's tool servers (grove-tools.ts) as in-process Claude Agent SDK MCP
 * servers. Claude Code adapter-specific.
 */
import type { GroveServer } from './grove-tools.js';
import { loadClaudeSdk } from './claude-sdk.js';

export async function toSdkMcpServer(server: GroveServer) {
  const { createSdkMcpServer, tool } = await loadClaudeSdk();
  return createSdkMcpServer({
    name: server.name,
    ...(server.instructions ? { instructions: server.instructions } : {}),
    ...(server.alwaysLoad ? { alwaysLoad: true } : {}),
    tools: server.tools.map((t) => tool(
      t.name,
      t.description,
      t.shape,
      t.run,
      { ...(t.searchHint ? { searchHint: t.searchHint } : {}), annotations: t.annotations },
    )),
  });
}
