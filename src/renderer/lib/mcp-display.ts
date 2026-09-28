import type { McpServerInfo } from '../../shared/types.js';

/** Where a live MCP server comes from, for the popover's tag. Uses the
 *  reported `source` (trusted over the name), else the config scope. */
export function mcpSourceLabel(server: Pick<McpServerInfo, 'source' | 'scope'>): string | undefined {
  const origin = server.source ?? server.scope;
  switch (origin) {
    case undefined:
    case '':
      return undefined;
    case 'sdk':
      return 'Grove Bench';
    case 'claudeai':
      return 'claude.ai';
    default:
      return origin;
  }
}
