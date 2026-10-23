/**
 * Grove Memory MCP Server — exposes memory operations as SDK MCP tools.
 * Claude Code adapter-specific: the tools themselves are in grove-tools.ts.
 */
import type { MemoryOperations } from './types.js';
import { memoryServer } from './grove-tools.js';
import { toSdkMcpServer } from './sdk-mcp.js';

export async function createMemoryMcpServer(ops: MemoryOperations) {
  return toSdkMcpServer(memoryServer(ops));
}

