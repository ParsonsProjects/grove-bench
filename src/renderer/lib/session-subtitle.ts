import type { ChatMessage } from '../stores/messages.svelte.js';

/** Visual tone of the subtitle line — drives its color in the sidebar. */
export type SubtitleTone = 'working' | 'waiting' | 'context';

export interface SessionSubtitle {
  text: string;
  tone: SubtitleTone;
}

const MAX_LEN = 90;

function collapse(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_LEN ? `${normalized.slice(0, MAX_LEN)}…` : normalized;
}

/** The tool name of the most recent unresolved permission request, if any. */
export function pendingPermissionTool(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'permission' && !m.resolved) return m.toolName;
    if (m.kind === 'question' && !m.resolved) return 'question';
  }
  return null;
}

/** Most recent user/assistant text in the loaded messages (slash commands skipped). */
export function lastTextSnippet(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'text' && m.text.trim()) return collapse(m.text);
    if (m.kind === 'user' && m.text.trim() && !m.text.trim().startsWith('/')) return collapse(m.text);
  }
  return null;
}

/** First real user prompt in the loaded messages (slash commands skipped). */
export function firstPromptSnippet(messages: ChatMessage[]): string | null {
  for (const m of messages) {
    if (m.kind === 'user' && m.text.trim() && !m.text.trim().startsWith('/')) return collapse(m.text);
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
      text: input.pendingTool === 'question' ? 'Waiting for your answer' : `Waiting for approval — ${input.pendingTool}`,
      tone: 'waiting',
    };
  }

  if (input.isRunning) {
    const { activity, toolName, toolSummary } = input.activity;
    if (activity === 'tool_starting' && toolName) {
      return { text: collapse(toolSummary ? `${toolName}: ${toolSummary}` : `Running ${toolName}…`), tone: 'working' };
    }
    if (activity === 'thinking') return { text: 'Thinking…', tone: 'working' };
    return { text: 'Working…', tone: 'working' };
  }

  const context = input.lastText || input.firstPrompt;
  return context ? { text: collapse(context), tone: 'context' } : null;
}
