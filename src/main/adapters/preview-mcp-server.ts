/**
 * Grove Preview MCP Server — exposes the conversation's Preview browser to the
 * agent as SDK MCP tools. Claude Code adapter-specific: the tools themselves
 * are in grove-tools.ts.
 *
 * The tools drive "the agent's page", separate from the page the user browses,
 * and only open local URLs. The user can watch it in the Preview tab.
 */
import type { PreviewOperations } from './types.js';
import { previewServer, previewToolHandlers } from './grove-tools.js';
import { toSdkMcpServer } from './sdk-mcp.js';

export { previewToolHandlers };

/** Tools that only look (or load a local page). Run without a prompt. */
export const GROVE_PREVIEW_READ_TOOL_NAMES = [
  'mcp__grove-preview__preview_open',
  'mcp__grove-preview__preview_screenshot',
  'mcp__grove-preview__preview_read',
  'mcp__grove-preview__preview_logs',
] as const;

/** Tools that act on the page. They ask like any other action tool. */
export const GROVE_PREVIEW_ACTION_TOOL_NAMES = [
  'mcp__grove-preview__preview_click',
  'mcp__grove-preview__preview_type',
] as const;

export async function createPreviewMcpServer(ops: PreviewOperations) {
  return toSdkMcpServer(previewServer(ops));
}
