/**
 * The names of Grove's own MCP servers and their tools, which
 * main/adapters/grove-tools.ts defines (a test keeps the two in step). Here
 * with no imports, so main and the UI can tell Grove's calls apart.
 */
export const GROVE_TOOL_NAMES = {
  'grove-memory': ['memory_list', 'memory_read', 'memory_write', 'memory_delete'],
  'grove-preview': ['preview_open', 'preview_screenshot', 'preview_read', 'preview_logs', 'preview_click', 'preview_type'],
} as const;

export type GroveServerName = keyof typeof GROVE_TOOL_NAMES;

export const GROVE_SERVER_NAMES = Object.keys(GROVE_TOOL_NAMES) as GroveServerName[];

/**
 * Which of Grove's tools a call is, from the name the agent gives it, in the
 * forms that name Grove's server: Claude Code's `mcp__grove-memory__memory_read`,
 * OpenCode's `grove-memory_memory_read`, and Gemini CLI's
 * `memory_list (grove-memory MCP Server)`. Gemini CLI titles a call that has
 * arguments `memory_read(path: …)`, without the server, so that can't be told
 * from another server's tool of the same name and isn't matched.
 */
export function groveToolOf(name: string): { server: GroveServerName; tool: string } | null {
  const trimmed = name.trim();
  const named = /^(?:mcp__)?(grove-memory|grove-preview)(?:__|_)(\w+)$/.exec(trimmed);
  if (named) return { server: named[1] as GroveServerName, tool: named[2] };
  const titled = /^(\w+) \((grove-memory|grove-preview) MCP Server\)$/.exec(trimmed);
  return titled ? { server: titled[2] as GroveServerName, tool: titled[1] } : null;
}

const GROVE_TOOL_TITLE = new RegExp(`^(?:${Object.values(GROVE_TOOL_NAMES).flat().join('|')})(?:\\(|$)`);

/** Whether a title names one of Grove's tools first, as Gemini CLI titles a
 *  call with arguments (`memory_read(path: "a.md")`). For display only:
 *  another server's tool of the same name reads the same. */
export function titledAsGroveTool(title: string): boolean {
  return groveToolOf(title) !== null || GROVE_TOOL_TITLE.test(title.trim());
}
