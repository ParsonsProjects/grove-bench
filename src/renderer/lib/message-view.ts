import type { ChatMessage } from '../stores/messages.svelte.js';
import type { ActivityViewMode } from '../../shared/types.js';

/** See ActivityViewMode in shared/types.ts for what each mode shows. */
export type MessageViewMode = ActivityViewMode;

export const VIEW_MODE_LABELS: Record<MessageViewMode, string> = {
  detailed: 'Detailed',
  summary: 'Summary',
  focus: 'Focus',
};

/** Short description of what each mode shows, for pickers and hints. */
export const VIEW_MODE_DESCRIPTIONS: Record<MessageViewMode, string> = {
  detailed: 'Everything: thinking, every tool call, system notes',
  summary: 'Hides thinking and most tool calls (edits, writes and shell commands stay)',
  focus: 'Agent responses and pending questions only (no tool calls or thinking)',
};

/** Cycle order for the status-bar toggle: Summary → Focus → Detailed → Summary. */
export const NEXT_VIEW_MODE: Record<MessageViewMode, MessageViewMode> = {
  summary: 'focus',
  focus: 'detailed',
  detailed: 'summary',
};

export const VIEW_MODE_HINTS: Record<MessageViewMode, string> = {
  detailed: 'Showing everything — click for Summary',
  summary: 'Hiding thinking & most tool calls — click for Focus (responses only)',
  focus: 'Showing agent responses & pending questions only — click for Detailed',
};

/** Tool calls shown in summary mode (everything else is hidden when details are off). */
const SUMMARY_VISIBLE_TOOLS = new Set(['Edit', 'Write', 'Bash']);

/**
 * Whether a message is rendered in the Activity panel for the given view mode.
 * Single source of truth shared by the panel's filter and the search-scroll logic
 * so the two can never disagree about what's on screen.
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
      // user, text, error, result. Every assistant text block is kept: agents
      // routinely split one answer across several blocks (findings, then next
      // steps), so keeping only the last would hide the part that matters.
      return true;
  }
}

/** Filter a message list down to what's visible for the current view mode. */
export function filterVisibleMessages(messages: ChatMessage[], mode: MessageViewMode): ChatMessage[] {
  return messages.filter((m) => isMessageVisible(m, mode));
}
