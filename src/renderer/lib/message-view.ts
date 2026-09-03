import type { ChatMessage } from '../stores/messages.svelte.js';

/**
 * Activity panel view modes:
 * - 'detailed': everything (tool calls, thinking, system, ...)
 * - 'summary':  hides thinking and non-essential tool calls
 * - 'focus':    only user prompts, the final assistant text of each turn,
 *               unanswered permission/question blocks, and errors
 */
export type MessageViewMode = 'detailed' | 'summary' | 'focus';

/** Tool calls shown in summary mode (everything else is hidden when details are off). */
const SUMMARY_VISIBLE_TOOLS = new Set(['Edit', 'Write', 'Bash']);

/**
 * Whether a message is rendered in the Activity panel for the given view mode.
 * Single source of truth shared by the panel's filter and the search-scroll logic
 * so the two can never disagree about what's on screen.
 *
 * Note: in focus mode, 'text' messages are additionally narrowed to the final
 * one per turn — that requires list context, so it lives in
 * filterVisibleMessages. A 'text' message returning true here may still be
 * dropped there.
 */
export function isMessageVisible(msg: ChatMessage, mode: MessageViewMode): boolean {
  // Tool calls awaiting a permission decision are never rendered (the permission
  // block stands in for them until resolved).
  if (msg.kind === 'tool_call' && msg.awaitingPermission) return false;

  if (mode === 'detailed') return true;

  // Both reduced modes hide thinking.
  if (msg.kind === 'thinking') return false;

  if (mode === 'summary') {
    if (msg.kind === 'tool_call') return SUMMARY_VISIBLE_TOOLS.has(msg.toolName);
    return true;
  }

  // Focus mode: only what the user must read or act on.
  switch (msg.kind) {
    case 'tool_call':
    case 'system':
      return false;
    case 'permission':
    case 'question':
      return !msg.resolved;
    default:
      // user, text (narrowed to final-per-turn in filterVisibleMessages),
      // error, result
      return true;
  }
}

/**
 * IDs of the last 'text' message in each turn. A turn ends at a 'user' or
 * 'result' message (or the end of the list, so a still-running turn shows its
 * latest text).
 */
function collectFinalTextIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  let lastTextId: string | null = null;
  for (const msg of messages) {
    if (msg.kind === 'user' || msg.kind === 'result') {
      if (lastTextId) ids.add(lastTextId);
      lastTextId = null;
    } else if (msg.kind === 'text') {
      lastTextId = msg.id;
    }
  }
  if (lastTextId) ids.add(lastTextId);
  return ids;
}

/** Filter a message list down to what's visible for the current view mode. */
export function filterVisibleMessages(messages: ChatMessage[], mode: MessageViewMode): ChatMessage[] {
  if (mode !== 'focus') {
    return messages.filter((m) => isMessageVisible(m, mode));
  }
  // Focus mode: interim assistant text (status notes between tool calls) is
  // hidden — only the final text of each turn survives.
  const finalTextIds = collectFinalTextIds(messages);
  return messages.filter(
    (m) => isMessageVisible(m, mode) && (m.kind !== 'text' || finalTextIds.has(m.id))
  );
}
