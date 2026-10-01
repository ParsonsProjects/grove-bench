import type { ChatMessage } from '../stores/messages.svelte.js';
import type { ActivityViewMode } from '../../shared/types.js';
import { parseMcpToolName } from './tool-names.js';
import { changesFiles, toolViewOf } from '../../shared/tool-view.js';

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
  summary: 'Hides thinking and most tool calls (edits, writes, shell commands, images and subagents stay)',
  focus: 'Agent responses, questions and your answers only (no tool calls or thinking; subagents show as one line)',
};

/** Grove's own MCP servers (the Preview browser, project memory): local, and
 *  too frequent for Summary. */
const GROVE_MCP_SERVERS = new Set(['grove-preview', 'grove-memory']);

/** A call that started a subagent. It stays in every view as one line that
 *  opens the subagent's own thread, so its work is never out of reach. */
export function isAgentCall(msg: ChatMessage): boolean {
  return msg.kind === 'tool_call' && toolViewOf(msg).kind === 'agent';
}

/** What an Agent call asked for, as far as Claude Code's input says: the kind
 *  of subagent (Explore, general-purpose, ...) and the prompt it was given. */
export function agentCallInput(toolInput: unknown): { agentType?: string; prompt?: string } {
  if (!toolInput || typeof toolInput !== 'object') return {};
  const { subagent_type: agentType, prompt } = toolInput as Record<string, unknown>;
  return {
    ...(typeof agentType === 'string' && agentType ? { agentType } : {}),
    ...(typeof prompt === 'string' && prompt ? { prompt } : {}),
  };
}

/** The Agent call a subagent's message belongs under, or undefined for the
 *  conversation's own messages. */
export function subagentOf(msg: ChatMessage): string | undefined {
  return 'parentToolUseId' in msg ? msg.parentToolUseId : undefined;
}

const NO_MESSAGES: ChatMessage[] = [];
const threadsByList = new WeakMap<ChatMessage[], Map<string | undefined, ChatMessage[]>>();

/**
 * One thread's messages: the conversation's own (no parentToolUseId), or one
 * subagent's (the id of the Agent call that started it). Grouped once per
 * list: a list is replaced on every change, never edited in place.
 */
export function threadMessages(messages: ChatMessage[], parentToolUseId?: string): ChatMessage[] {
  let threads = threadsByList.get(messages);
  if (!threads) {
    threads = new Map();
    for (const m of messages) {
      const key = subagentOf(m);
      const thread = threads.get(key);
      if (thread) thread.push(m);
      else threads.set(key, [m]);
    }
    // Without subagents the conversation's thread is the list itself.
    if (threads.size === 1 && threads.has(undefined)) threads.set(undefined, messages);
    threadsByList.set(messages, threads);
  }
  return threads.get(parentToolUseId) ?? NO_MESSAGES;
}

/** Whether summary mode shows a tool call: the ones that change files or run
 *  commands, and MCP tools other than Grove's own, since they can act outside
 *  the project, such as creating a ticket or sending a message. */
function shownInSummary(call: Extract<ChatMessage, { kind: 'tool_call' }>): boolean {
  if (changesFiles(toolViewOf(call), call.toolCategory)) return true;
  const mcp = parseMcpToolName(call.toolName);
  return !!mcp && !GROVE_MCP_SERVERS.has(mcp.server);
}

/**
 * Whether a message is rendered in its thread for the given view mode.
 * Single source of truth shared by the panel's filter and the search-scroll logic
 * so the two can never disagree about what's on screen. Which thread a message
 * is in is threadMessages()'s concern.
 */
export function isMessageVisible(msg: ChatMessage, mode: MessageViewMode): boolean {
  // Tool calls awaiting a permission decision are never rendered (the permission
  // block stands in for them until resolved).
  if (msg.kind === 'tool_call' && msg.awaitingPermission) return false;

  if (mode === 'detailed') return true;

  // Both reduced modes hide thinking.
  if (msg.kind === 'thinking') return false;

  if (mode === 'summary') {
    // A tool that returned images (a preview screenshot, an image file read)
    // stays in view so the images do.
    if (msg.kind === 'tool_call') return shownInSummary(msg) || isAgentCall(msg) || !!msg.images?.length;
    return true;
  }

  // Focus mode: only what the user must read or act on.
  switch (msg.kind) {
    case 'tool_call':
      return isAgentCall(msg);
    case 'system':
      return false;
    case 'permission':
      return !msg.resolved;
    case 'question':
      // Questions stay visible once answered: the block shows the user's
      // reply, which is part of the conversation the user needs to follow.
      return true;
    default:
      // user, text, error, git_identity_missing, result. Every assistant text block is kept: agents
      // routinely split one answer across several blocks (findings, then next
      // steps), so keeping only the last would hide the part that matters.
      return true;
  }
}

/** Filter a message list down to what's visible for the current view mode. */
export function filterVisibleMessages(messages: ChatMessage[], mode: MessageViewMode): ChatMessage[] {
  return messages.filter((m) => isMessageVisible(m, mode));
}

/**
 * Whether a chat, as filtered for its view mode, shows anything from the
 * agent yet: a message other than the user's own and the app's notes. The end
 * of a turn (result, error) counts, so a turn that ends without a reply does.
 */
export function hasAgentReply(visible: ChatMessage[]): boolean {
  return visible.some((m) => m.kind !== 'user' && m.kind !== 'system' && m.kind !== 'git_identity_missing');
}
