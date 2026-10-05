/**
 * Switching a conversation to another agent. The new agent starts a session
 * of its own, so it knows nothing of the conversation; when the user agreed
 * to it, the first message it gets carries a short transcript built from
 * Grove's own event log: the user's messages, the agents' replies and the
 * files changed. No tool output, no thinking.
 *
 * This is the one place a conversation's content goes from one provider to
 * another, so it only happens when the user picked it in the switch dialog,
 * which says so. Background tasks read only what came after the last switch
 * (eventsSinceAgentChange).
 */
import type { AgentEvent } from '../shared/types.js';
import { subagentParent } from '../shared/types.js';
import { changesFiles, toolViewOf } from '../shared/tool-view.js';

/** The longest transcript sent, in characters (roughly 8k tokens). */
export const HANDOFF_MAX_CHARS = 32_000;
/** One message's share before it is cut. */
const MESSAGE_MAX_CHARS = 2_000;

type AgentChanged = Extract<AgentEvent, { type: 'agent_changed' }>;

/**
 * The part of a conversation the agent it runs on now took part in: the
 * events after the last switch. Background tasks (memory notes, the goal,
 * skill suggestions) run on the conversation's agent, so they read only
 * this, and nothing from before a switch reaches the new provider except
 * the transcript the user agreed to.
 */
export function eventsSinceAgentChange<T extends { type: string }>(events: readonly T[]): T[] {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'agent_changed') return events.slice(i + 1);
  }
  return [...events];
}

/** The last switch in `events`, or null. */
export function lastAgentChange(events: readonly AgentEvent[]): AgentChanged | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'agent_changed') return e;
  }
  return null;
}

/** A message the agent reads as a command, which must lead the text. */
export function isSlashCommand(text: string): boolean {
  return /^\s*\/[A-Za-z]/.test(text);
}

/** Events that show the new agent got a message and answered it. */
const REPLIES: ReadonlySet<AgentEvent['type']> = new Set(['assistant_text', 'assistant_tool_use', 'thinking']);

/** The switch whose transcript the agent hasn't had yet: the last
 *  agent_changed, when it asked for one and the new agent hasn't replied
 *  since. A first message lost to a failed start leaves it pending. */
export function pendingHandoff(history: readonly AgentEvent[]): { index: number; event: AgentChanged } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (REPLIES.has(e.type) && !subagentParent(e)) return null;
    if (e.type === 'agent_changed') return e.transcript ? { index: i, event: e } : null;
  }
  return null;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)} […]` : t;
}

/**
 * The note that leads the new agent's first message: who had the
 * conversation, what was said (newest kept when it is long) and which files
 * changed. `events` is the log up to the switch.
 */
export function handoffTranscript(events: readonly AgentEvent[], switched: AgentChanged): string {
  // Who answered each turn: the agent before the first switch, then each
  // switch's new agent.
  const firstSwitch = events.find((e): e is AgentChanged => e.type === 'agent_changed');
  let speaker = firstSwitch?.fromName ?? switched.fromName;
  const lines: string[] = [];
  const files = new Set<string>();
  let reply = '';
  const flush = () => {
    if (reply.trim()) lines.push(`${speaker}: ${clip(reply, MESSAGE_MAX_CHARS)}`);
    reply = '';
  };
  for (const e of events) {
    if (e.type === 'agent_changed') {
      flush();
      speaker = e.toName;
    } else if (e.type === 'user_message') {
      flush();
      lines.push(`User: ${clip(e.text, MESSAGE_MAX_CHARS)}`);
    } else if (e.type === 'assistant_text' && !subagentParent(e)) {
      reply += (reply ? '\n' : '') + e.text;
    } else if (e.type === 'assistant_tool_use') {
      const view = toolViewOf(e);
      if (view.path && changesFiles(view, e.toolCategory)) files.add(view.path);
    }
  }
  flush();

  // Keep the newest turns when it's long: they matter most to carrying on.
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > HANDOFF_MAX_CHARS && kept.length > 0) {
      kept.unshift('[earlier messages left out]');
      break;
    }
    kept.unshift(lines[i]);
    size += lines[i].length + 2;
  }

  const fileList = [...files];
  return [
    `Note from Grove Bench, the app running this conversation: it started with ${switched.fromName}, and the user has switched it to you in the same folder. Below is a short transcript of it so far (messages only, no tool output). The files may have changed since, so read them for their current state.`,
    '',
    '<transcript>',
    kept.length > 0 ? kept.join('\n\n') : '(no messages yet)',
    '</transcript>',
    ...(fileList.length > 0 ? ['', `Files changed so far: ${fileList.slice(0, 50).join(', ')}${fileList.length > 50 ? `, and ${fileList.length - 50} more` : ''}`] : []),
    '',
    'The user\'s next message follows.',
    '',
  ].join('\n');
}
