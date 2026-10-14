/**
 * A thread saved to a file the user picks (the sidebar's Export Thread…):
 * Markdown to read, or JSON to keep everything.
 *
 * The Markdown has the messages, each tool call as one line saying what it
 * worked on, and errors. No tool output and no thinking, which would bury
 * the conversation; the JSON has all of it, as the thread's saved events.
 */
import type { AgentEvent } from '../shared/types.js';
import { subagentParent } from '../shared/types.js';
import { toolViewOf, toolViewSummary } from '../shared/tool-view.js';
import { localDay } from '../shared/limits.js';
import { userEventParts } from '../shared/prompt-text.js';

export interface ThreadExportInfo {
  id: string;
  /** What the sidebar calls it: its name, or its branch. */
  title: string;
  project: string;
  branch: string;
  /** The agent the thread runs on now. */
  agent: string;
}

/** Bumped when the JSON's shape changes. */
export const THREAD_EXPORT_VERSION = 1;

type AgentChanged = Extract<AgentEvent, { type: 'agent_changed' }>;

/** `text` as inline code, on one line (its first, when it has more), with
 *  a fence it can't close early. */
function inlineCode(text: string): string {
  const lines = text.trim().split(/\r\n|\r|\n/);
  const line = lines.length > 1 ? `${lines[0]} …` : lines[0];
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

/** `text` on one line, read as plain text rather than Markdown or HTML (a
 *  tool name can be an agent's title for the call). */
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[\\`*[\]<>#~]/g, '\\$&');
}

type ToolCall = Pick<Extract<AgentEvent, { type: 'assistant_tool_use' }>, 'toolName' | 'toolInput' | 'toolView'>;

/** Each tool call as the thread shows it: with the updates applied that
 *  fill it in as it runs (ACP agents send its name and input that way). */
function toolCalls(events: readonly AgentEvent[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const e of events) {
    if (e.type === 'assistant_tool_use') {
      calls.set(e.toolUseId, { toolName: e.toolName, toolInput: e.toolInput, toolView: e.toolView });
    } else if (e.type === 'tool_update') {
      const call = calls.get(e.toolUseId);
      if (!call) continue;
      if (e.toolName !== undefined) call.toolName = e.toolName;
      if (e.toolInput !== undefined) call.toolInput = e.toolInput;
      if (e.toolView !== undefined) call.toolView = e.toolView;
    }
  }
  return calls;
}

/** The thread as Markdown: a heading per speaker, the messages as written
 *  (they are Markdown already, and are left exactly as they are), and a
 *  line per tool call. */
export function threadMarkdown(events: readonly AgentEvent[], info: ThreadExportInfo, exportedAt: Date): string {
  const calls = toolCalls(events);
  // Who answered each turn: the agent before the first switch, then each
  // switch's new agent (as the handoff transcript does).
  const firstSwitch = events.find((e): e is AgentChanged => e.type === 'agent_changed');
  let agent = firstSwitch?.fromName ?? info.agent;

  /** Paragraphs, joined with a blank line. Tool lines in a row make one list. */
  const blocks: string[] = [[
    `# ${plain(info.title)}`,
    '',
    `Project: ${plain(info.project)}  `,
    ...(info.branch ? [`Branch: ${plain(info.branch)}  `] : []),
    `Exported from Grove Bench on ${localDay(exportedAt.getTime())}`,
  ].join('\n')];
  let inList = false;
  const add = (block: string) => {
    if (!block.trim()) return;
    blocks.push(block);
    inList = false;
  };
  const addListItem = (line: string) => {
    if (inList) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
    inList = true;
  };
  /** Whose turn the blocks below belong to, so a speaker gets one heading per turn. */
  let section: string | null = null;
  const speak = (who: string) => {
    if (section === who) return;
    section = who;
    add(`## ${plain(who)}`);
  };
  const error = (message: string) => {
    speak(agent);
    add(`> Error: ${plain(message)}`);
  };

  for (const e of events) {
    if (subagentParent(e)) continue;
    switch (e.type) {
      case 'user_message': {
        // What was typed, without the contents of attached text files and
        // @-mentioned files, which are sent with it.
        const { typed, names } = userEventParts(e);
        section = null;
        speak('You');
        add(typed.trim());
        if (names.length > 0) add(`Attached: ${names.map(inlineCode).join(', ')}`);
        break;
      }
      case 'assistant_text':
        speak(agent);
        add(e.text.trim());
        break;
      case 'tool_use_summary':
        speak(agent);
        add(e.summary.trim());
        break;
      case 'assistant_tool_use': {
        const call = calls.get(e.toolUseId) ?? e;
        const summary = toolViewSummary(toolViewOf(call));
        speak(agent);
        addListItem(`- ${plain(call.toolName)}${summary ? ` ${inlineCode(summary)}` : ''}`);
        break;
      }
      case 'permission_request':
        if (e.planText?.trim()) {
          speak(agent);
          add('**Proposed plan:**');
          add(e.planText.trim());
        }
        break;
      case 'permission_resolved':
        // An answer to the agent's question, or why the user said no.
        if (e.message?.trim()) {
          speak('You');
          add(e.message.trim());
        }
        break;
      case 'error':
        error(e.message);
        break;
      case 'result':
        if (e.isError) error(e.errors?.length ? e.errors.join('; ') : `the turn ended with ${e.subtype}`);
        break;
      case 'agent_changed':
        agent = e.toName;
        section = null;
        add(`*Switched from ${plain(e.fromName)} to ${plain(e.toName)}.*`);
        break;
    }
  }
  return `${blocks.join('\n\n')}\n`;
}

/** The thread as JSON: what it is, and every event it saved. */
export function threadJson(events: readonly AgentEvent[], info: ThreadExportInfo, exportedAt: Date): string {
  return `${JSON.stringify({
    groveBenchThread: THREAD_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    thread: info,
    events,
  }, null, 2)}\n`;
}

/** A file name for the save dialog: the title without characters Windows
 *  doesn't allow, kept short, and never a name Windows keeps for a device. */
export function exportFileName(title: string, extension: 'md' | 'json'): string {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
  // Windows keeps these for devices, with any extension too (AUX.ts is AUX).
  const name = /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\.|$)/i.test(safe) ? `Thread ${safe}` : safe;
  return `${name || 'Thread'}.${extension}`;
}
