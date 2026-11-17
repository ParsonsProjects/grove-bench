/**
 * Turn an error thrown by an MCP control IPC call into a message fit for the
 * status popup.
 *
 * Electron wraps errors thrown by `ipcMain.handle` handlers as
 * `Error invoking remote method 'agent:mcpReconnect': Error: <message>`, and
 * the Claude Code CLI refuses to reconnect a server that still needs OAuth
 * with the terse `Server status: needs-auth`. Neither is useful on its own.
 */

import { errorMessage } from '../../shared/error-message.js';

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/;

export type McpAction = 'reconnect' | 'enable' | 'disable';

/** Strip Electron's "Error invoking remote method" wrapper from a message. */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(IPC_PREFIX, '').trim();
}

/** What to show for an error from an IPC call: its message without
 *  Electron's wrapper, or `fallback` when that leaves nothing (an empty
 *  message would read as no error at all). */
export function ipcErrorText(e: unknown, fallback = 'no reason given'): string {
  return stripIpcErrorPrefix(errorMessage(e)) || fallback;
}

/** Human-readable instruction for a server stuck in `needs-auth`. */
export function mcpNeedsAuthHint(serverName: string): string {
  return `${serverName} needs authentication. Click Sign in to authorize it in your browser.`;
}

export function formatMcpActionError(err: unknown, action: McpAction, serverName: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const message = stripIpcErrorPrefix(raw);
  const status = message.match(/^Server status:\s*(\S+)/i)?.[1]?.toLowerCase();

  if (status === 'needs-auth') return mcpNeedsAuthHint(serverName);
  if (status === 'disabled') {
    return `${serverName} is disconnected. Use Connect to turn it back on.`;
  }
  if (status === 'pending') return `${serverName} is still connecting. Try again in a moment.`;
  if (status) return `${serverName} could not be ${pastTense(action)} (status: ${status}).`;

  if (!message) return `Failed to ${action} ${serverName}`;
  return message;
}

function pastTense(action: McpAction): string {
  return action === 'reconnect' ? 'reconnected' : `${action}d`;
}
