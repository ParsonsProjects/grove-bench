import type { ChatMessage } from '../stores/messages.svelte.js';
import { approvalRequest, toolLabel } from './tool-names.js';
import { oneLine, plainSnippet } from '../../shared/plain-text.js';

/** Visual tone of the subtitle line — drives its color in the sidebar. */
export type SubtitleTone = 'working' | 'waiting' | 'context';

export interface SessionSubtitle {
  text: string;
  tone: SubtitleTone;
}

const MAX_LEN = 90;

/** A chat message as one line of plain text: markdown syntax dropped. Null
 *  when nothing is left (a message that is only syntax), so the search goes on. */
function snippet(text: string, maxLen = MAX_LEN): string | null {
  return plainSnippet(text, maxLen) || null;
}

/** The tool name of the most recent unresolved permission request, if any. */
export function pendingPermissionTool(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'permission' && !m.resolved) return m.toolName;
    if ((m.kind === 'question' || m.kind === 'elicitation') && !m.resolved) return 'question';
  }
  return null;
}

/** Most recent user/assistant text in the loaded messages (slash commands skipped). */
export function lastTextSnippet(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const text = m.kind === 'text' || (m.kind === 'user' && !m.text.trim().startsWith('/')) ? snippet(m.text) : null;
    if (text) return text;
  }
  return null;
}

/** First real user prompt in the loaded messages (slash commands skipped).
 *  `maxLen` defaults to the sidebar row's length. */
export function firstPromptSnippet(messages: ChatMessage[], maxLen = MAX_LEN): string | null {
  for (const m of messages) {
    const text = m.kind === 'user' && !m.text.trim().startsWith('/') ? snippet(m.text, maxLen) : null;
    if (text) return text;
  }
  return null;
}

export interface SubtitleInput {
  /** Whether the agent is currently processing a turn. */
  isRunning: boolean;
  /** Current activity, from messageStore.getActivity(). */
  activity: { activity: 'thinking' | 'tool_starting' | 'generating' | 'idle'; toolName?: string; toolSummary?: string };
  /** Tool awaiting user approval (null when none). */
  pendingTool: string | null;
  /** Most recent conversation text (loaded messages or main-process preview). */
  lastText: string | null;
  /** First user prompt (loaded messages or main-process preview). */
  firstPrompt: string | null;
}

/**
 * One-line context subtitle for a sidebar session row, most urgent first:
 * waiting-for-approval > live activity > last message > first prompt.
 * Returns null when there is nothing meaningful to show.
 */
export function sessionSubtitle(input: SubtitleInput): SessionSubtitle | null {
  if (input.pendingTool) {
    return {
      text: input.pendingTool === 'question' ? 'Waiting for your answer' : capitalise(approvalRequest(input.pendingTool)),
      tone: 'waiting',
    };
  }

  if (input.isRunning) {
    const { activity, toolName, toolSummary } = input.activity;
    if (activity === 'tool_starting' && toolName) {
      const name = toolLabel(toolName);
      return { text: oneLine(toolSummary ? `${name}: ${toolSummary}` : `Running ${name}…`, MAX_LEN), tone: 'working' };
    }
    if (activity === 'thinking') return { text: 'Thinking…', tone: 'working' };
    return { text: 'Working…', tone: 'working' };
  }

  const context = input.lastText || input.firstPrompt;
  return context ? { text: oneLine(context, MAX_LEN), tone: 'context' } : null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
