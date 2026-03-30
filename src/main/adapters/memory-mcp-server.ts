/**
 * Grove Memory MCP Server — exposes memory operations as SDK MCP tools.
 * Claude Code adapter-specific: wraps the generic MemoryOperations interface
 * into an in-process SDK MCP server via createSdkMcpServer().
 */
import type { MemoryOperations } from './types.js';

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

/** Tool names as they appear to the agent after MCP registration. */
export const GROVE_MEMORY_TOOL_NAMES = [
  'mcp__grove-memory__memory_list',
  'mcp__grove-memory__memory_read',
  'mcp__grove-memory__memory_write',
  'mcp__grove-memory__memory_delete',
] as const;

export async function createMemoryMcpServer(ops: MemoryOperations) {
  await ensureSdk();

  const { z } = await import('zod/v4');

  return _createSdkMcpServer({
    name: 'grove-memory',
    tools: [
      _tool('memory_list', 'List all memory files for this project', {}, async () => {
        const entries = ops.list();
        return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
      }, { annotations: { readOnly: true } }),

      _tool('memory_read', 'Read a memory file by relative path', {
        path: z.string().describe('Relative path within the memory directory, e.g. "repo/overview.md"'),
      }, async ({ path }) => {
        const content = ops.read(path);
        if (content === null) {
          return { content: [{ type: 'text' as const, text: `File not found: ${path}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: content }] };
      }, { annotations: { readOnly: true } }),

      _tool('memory_write', 'Write or update a memory file', {
        path: z.string().describe('Relative path (must end in .md), e.g. "sessions/current-plan.md"'),
        content: z.string().describe('Full file content including YAML frontmatter'),
      }, async ({ path, content }) => {
        ops.write(path, content);
        return { content: [{ type: 'text' as const, text: `Written: ${path}` }] };
      }, { annotations: { destructive: false } }),

      _tool('memory_delete', 'Delete a memory file', {
        path: z.string().describe('Relative path of the file to delete'),
      }, async ({ path }) => {
        const deleted = ops.delete(path);
        return {
          content: [{ type: 'text' as const, text: deleted ? `Deleted: ${path}` : `Not found: ${path}` }],
          isError: !deleted,
        };
      }, { annotations: { destructive: true } }),
    ],
  });
}
