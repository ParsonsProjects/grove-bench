import type { ChatMessage } from '../stores/messages.svelte.js';
import type { ActivityViewMode } from '../../shared/types.js';
import { changesFiles, toolViewOf, type ToolView } from '../../shared/tool-view.js';
import { taskListOf } from '../../shared/thread-items.js';
import { GROVE_SERVER_NAMES, titledAsGroveTool } from '../../shared/grove-tools.js';

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
  summary: 'Hides thinking and most tool calls (edits, writes, shell commands, images and subagents stay); notes while working fold into one line',
  focus: 'Agent responses, questions and your answers only (no tool calls or thinking; notes while working fold into one line; images stay; subagents show as one line)',
};

/** Grove's own MCP servers (the Preview browser, project memory): local, and
 *  too frequent for Summary. */
const GROVE_MCP_SERVERS: ReadonlySet<string> = new Set(GROVE_SERVER_NAMES);

/** A call that started a subagent. It stays in every view as one line that
 *  opens the subagent's own thread, so its work is never out of reach. */
export function isAgentCall(msg: ChatMessage): boolean {
  return msg.kind === 'tool_call' && toolViewOf(msg).kind === 'agent';
}

/** What a call that starts a subagent asked for, from its view: the kind of
 *  subagent (Explore, general-purpose, ...) and the prompt it was given. */
export function agentCallInput(call: { toolName: string; toolInput: unknown; toolView?: ToolView } | undefined): { agentType?: string; prompt?: string } {
  if (!call) return {};
  const { agentType, prompt } = toolViewOf(call);
  return { ...(agentType ? { agentType } : {}), ...(prompt ? { prompt } : {}) };
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
 *  the project, such as creating a ticket or sending a message. Another
 *  agent's call Grove can't place (ACP doesn't mark MCP calls) stays too, for
 *  the same reason, unless it is titled as one of Grove's tools (as Gemini
 *  CLI titles them, without the server) or only carries a to-do list. */
function shownInSummary(call: Extract<ChatMessage, { kind: 'tool_call' }>): boolean {
  const view = toolViewOf(call);
  if (changesFiles(view, call.toolCategory)) return true;
  if (view.mcp) return !GROVE_MCP_SERVERS.has(view.mcp.server);
  return !!call.toolView && view.kind === 'other' && (call.toolCategory ?? 'other') === 'other'
    && !titledAsGroveTool(call.toolName) && !taskListOf(call.toolName, call.toolInput);
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
      // A tool's images (a screenshot) are output to look at: they show on
      // their own, without the tool call (focusImagesOnly).
      return isAgentCall(msg) || !!msg.images?.length;
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
      // The notes written while working fold into one line instead
      // (narrationIds).
      return true;
  }
}

/** Whether a message shows only the images its tool returned: a tool call
 *  Focus keeps for its images (isMessageVisible), which hides tool calls. */
export function focusImagesOnly(msg: ChatMessage, mode: MessageViewMode): boolean {
  return mode === 'focus' && msg.kind === 'tool_call' && !isAgentCall(msg) && !!msg.images?.length;
}

/** Filter a message list down to what's visible for the current view mode. */
export function filterVisibleMessages(messages: ChatMessage[], mode: MessageViewMode): ChatMessage[] {
  return messages.filter((m) => isMessageVisible(m, mode));
}

/**
 * The agent's notes while it works ("Let me check the config"), which Summary
 * and Focus fold into one line: text followed by another tool call in the
 * same turn.
 * Text after a turn's last tool call is the answer, however many blocks it is
 * split across. Text just before a question, or a permission prompt still
 * waiting, explains what is being asked, so it stays too.
 */
export function narrationIds(thread: ChatMessage[]): Set<string> {
  const asksUser = new Set<string>();
  for (const m of thread) {
    if (m.kind === 'question' || (m.kind === 'permission' && !m.resolved)) asksUser.add(m.toolUseId);
  }
  const ids = new Set<string>();
  let notes: string[] = [];
  for (const m of thread) {
    if (m.kind === 'text') {
      notes.push(m.id);
    } else if (m.kind === 'tool_call') {
      if (!asksUser.has(m.toolUseId) && toolViewOf(m).kind !== 'question') for (const id of notes) ids.add(id);
      notes = [];
    } else if (m.kind === 'user' || m.kind === 'result') {
      notes = [];
    }
  }
  return ids;
}

/** A row of the thread: one message, or a run of notes folded together. */
export type ThreadRow =
  | { kind: 'message'; msg: ChatMessage }
  | { kind: 'notes'; msgs: ChatMessage[] };

/** Each message's row, kept while the message is: the thread derives its
 *  rows again on every new message, and a new row object reruns everything
 *  drawn from it (an edit's diff among them). */
const messageRows = new WeakMap<ChatMessage, ThreadRow>();

/** Visible messages as rows, each run of notes (narrationIds) in one row. */
export function foldNarration(visible: ChatMessage[], notes: Set<string>): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const msg of visible) {
    const last = rows[rows.length - 1];
    if (!notes.has(msg.id)) {
      let row = messageRows.get(msg);
      if (!row) messageRows.set(msg, row = { kind: 'message', msg });
      rows.push(row);
    }
    else if (last?.kind === 'notes') last.msgs.push(msg);
    else rows.push({ kind: 'notes', msgs: [msg] });
  }
  return rows;
}

/**
 * Whether a chat, as filtered for its view mode, shows anything from the
 * agent yet: a message other than the user's own and the app's notes. The end
 * of a turn (result, error) counts, so a turn that ends without a reply does.
 */
export function hasAgentReply(visible: ChatMessage[]): boolean {
  return visible.some((m) => m.kind !== 'user' && m.kind !== 'system' && m.kind !== 'git_identity_missing');
}
