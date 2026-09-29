import type { ToolCategory } from '../../shared/types.js';

const LASTS = 'Lasts until you stop the conversation or restart Grove Bench.';

/**
 * Button text and tooltip for a permission prompt's "always allow" choice.
 *
 * For file edits (the 'edit' category) the renderer switches the whole
 * conversation to Edit mode (messageStore.resolvePermission), so the label
 * says that. Anything else is approved tool-wide from then on (agent-session's
 * `alwaysAllowedTools`), not just this command or URL; that survives idle
 * sleep but not stopping the conversation or restarting the app, since both
 * drop the live session.
 */
export function alwaysAllowLabel(toolName: string, category?: ToolCategory): { label: string; title: string } {
  if (category === 'edit') {
    return {
      label: 'Allow all edits (Edit mode)',
      title: 'Switches this conversation to Edit mode: file edits inside the worktree, new files included, are applied without asking. Commands still ask. Switch back in the agent settings (Alt+M).',
    };
  }
  const { label, covers } = scope(toolName, category);
  return { label, title: `${covers} ${LASTS}` };
}

function scope(toolName: string, category?: ToolCategory): { label: string; covers: string } {
  if (category === 'bash' || toolName === 'Bash') {
    return { label: 'Allow all commands', covers: 'Runs every shell command in this conversation without asking.' };
  }
  if (category === 'web_fetch' || toolName === 'WebFetch') {
    return { label: 'Allow all web fetches', covers: 'Fetches any web address in this conversation without asking.' };
  }
  if (toolName === 'NotebookEdit') {
    return { label: 'Allow all notebook edits', covers: 'Applies every notebook edit in this conversation without asking.' };
  }
  const name = mcpToolName(toolName) ?? toolName;
  return { label: `Always allow ${name}`, covers: `Runs every ${name} call in this conversation without asking.` };
}

/** `mcp__<server>__<tool_name>` → `tool name`, the part a person recognises. */
function mcpToolName(toolName: string): string | null {
  if (!toolName.startsWith('mcp__')) return null;
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep >= 0 && sep + 2 < rest.length ? rest.slice(sep + 2).replace(/_/g, ' ') : null;
}
