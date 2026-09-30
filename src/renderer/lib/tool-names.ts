/**
 * Tool names as people read them. Agents name tools for the model
 * (`ExitPlanMode`, `mcp__linear__create_issue`); the UI says what the tool
 * does, or at least drops the plumbing.
 */

/** `mcp__<server>__<tool_name>` → its server and `tool name`. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep < 0 || sep + 2 >= rest.length) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2).replace(/_/g, ' ') };
}

/** A tool's name for display: an MCP tool as "tool name (server)", others as they are. */
export function toolLabel(toolName: string): string {
  const mcp = parseMcpToolName(toolName);
  if (!mcp) return toolName;
  return mcp.server ? `${mcp.tool} (${mcp.server})` : mcp.tool;
}

/** What the agent is asking to do, for a permission it's waiting on, such
 *  as "wants to run a command". Lower case, to follow "The agent" or to be
 *  capitalised on its own. */
export function approvalRequest(toolName: string): string {
  switch (toolName) {
    case 'ExitPlanMode':
      return 'has a plan for you to approve';
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'wants to edit a file';
    case 'Bash':
      return 'wants to run a command';
    case 'WebFetch':
      return 'wants to fetch a web page';
    case 'WebSearch':
      return 'wants to search the web';
    default:
      return `wants to use ${toolLabel(toolName)}`;
  }
}
