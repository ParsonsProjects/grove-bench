import type { ChatMessage } from '../stores/messages.svelte.js';

/** Tool calls shown in summary mode (everything else is hidden when details are off). */
const SUMMARY_VISIBLE_TOOLS = new Set(['Edit', 'Write', 'Bash']);

/**
 * Whether a message is rendered in the Activity panel given the detail toggle.
 * Single source of truth shared by the panel's filter and the search-scroll logic
 * so the two can never disagree about what's on screen.
 */
export function isMessageVisible(msg: ChatMessage, showDetails: boolean): boolean {
  // Tool calls awaiting a permission decision are never rendered (the permission
  // block stands in for them until resolved).
  if (msg.kind === 'tool_call' && msg.awaitingPermission) return false;

  if (showDetails) return true;

  // Summary mode: hide thinking and non-essential tool calls.
  if (msg.kind === 'thinking') return false;
  if (msg.kind === 'tool_call') return SUMMARY_VISIBLE_TOOLS.has(msg.toolName);
  return true;
}

/** Filter a message list down to what's visible for the current detail toggle. */
export function filterVisibleMessages(messages: ChatMessage[], showDetails: boolean): ChatMessage[] {
  return messages.filter((m) => isMessageVisible(m, showDetails));
}
