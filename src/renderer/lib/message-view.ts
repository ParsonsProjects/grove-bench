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

/** Collect string/number leaves from a tool-input object (bounded, for search indexing). */
function flattenInput(input: unknown, depth = 0): string {
  if (depth > 4 || input == null) return '';
  if (typeof input === 'string' || typeof input === 'number') return String(input);
  if (Array.isArray(input)) return input.map((v) => flattenInput(v, depth + 1)).join(' ');
  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>)
      .map((v) => flattenInput(v, depth + 1))
      .join(' ');
  }
  return '';
}

/**
 * Extract all searchable text from a message, across every kind — text, thinking,
 * tool names/inputs/results, permission/plan text, and question prompts. This lets
 * the message search find filenames, commands, tool output, and questions, not just
 * assistant/thinking prose.
 */
export function searchableText(msg: ChatMessage): string {
  switch (msg.kind) {
    case 'user':
    case 'text':
    case 'system':
    case 'error':
      return msg.text;
    case 'thinking':
      return msg.thinking;
    case 'tool_call':
      return [msg.toolName, flattenInput(msg.toolInput), msg.result ?? ''].join(' ');
    case 'permission':
      return [msg.toolName, flattenInput(msg.toolInput), msg.planText ?? '', msg.decisionReason ?? ''].join(' ');
    case 'question':
      return msg.questions
        .map((q) => [q.question, q.header, ...q.options.map((o) => `${o.label} ${o.description}`)].join(' '))
        .join(' ');
    case 'result':
      return [msg.result ?? '', ...(msg.errors ?? [])].join(' ');
    default:
      return '';
  }
}

/** Return the ids of messages whose searchable text contains the query (case-insensitive), in order. */
export function findMatchIds(messages: ChatMessage[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return messages.filter((m) => searchableText(m).toLowerCase().includes(q)).map((m) => m.id);
}
