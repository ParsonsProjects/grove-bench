/**
 * Grove Memory MCP Server — exposes memory operations as SDK MCP tools.
 * Claude Code adapter-specific: the tools themselves are in grove-tools.ts.
 */
import type { MemoryOperations } from './types.js';
import { memoryServer } from './grove-tools.js';
import { toSdkMcpServer } from './sdk-mcp.js';

/** Tool names as they appear to the agent after MCP registration. */
export const GROVE_MEMORY_TOOL_NAMES = [
  'mcp__grove-memory__memory_list',
  'mcp__grove-memory__memory_read',
  'mcp__grove-memory__memory_write',
  'mcp__grove-memory__memory_delete',
] as const;

export async function createMemoryMcpServer(ops: MemoryOperations) {
  return toSdkMcpServer(memoryServer(ops));
}

