/**
 * Grove Preview MCP Server — exposes the conversation's Preview browser to the
 * agent as SDK MCP tools. Claude Code adapter-specific: the tools themselves
 * are in grove-tools.ts.
 *
 * The tools drive "the agent's page", separate from the page the user browses,
 * and only open local URLs. The user can watch it in the Preview tab.
 */
import type { PreviewOperations } from './types.js';
import { previewServer, previewToolHandlers, type GroveServer } from './grove-tools.js';
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

/**
 * Claude Code's own ways of looking at a page that run a hidden headless
 * browser: the bundled run skill (its web app recipe drives chromium-cli or a
 * Playwright script) and the Artifact tool's preview action. Only Claude Code
 * has these, so this goes on its copy of the server, not the shared one.
 */
export const CLAUDE_PREVIEW_INSTRUCTIONS = 'If you use the run skill on a web app, open the page with preview_open '
  + 'instead of the skill\'s chromium-cli or Playwright driver. The Artifact tool\'s preview action is only for '
  + 'checking a page right before you publish it as an artifact.';

/** The Preview server as Claude Code gets it: the shared tools and
 *  instructions, plus CLAUDE_PREVIEW_INSTRUCTIONS. */
export function claudePreviewServer(ops: PreviewOperations): GroveServer {
  const server = previewServer(ops);
  return { ...server, instructions: [server.instructions, CLAUDE_PREVIEW_INSTRUCTIONS].filter(Boolean).join(' ') };
}

export async function createPreviewMcpServer(ops: PreviewOperations) {
  return toSdkMcpServer(claudePreviewServer(ops));
}
