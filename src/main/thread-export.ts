/**
 * A thread saved to a file the user picks (the sidebar's Export Thread…):
 * Markdown to read, or JSON to keep everything.
 *
 * The Markdown has the messages, each tool call as one line saying what it
 * worked on, and errors. No tool output and no thinking, which would bury
 * the conversation; the JSON has all of it, as the thread's saved events.
 */
import type { AgentEvent } from '../shared/types.js';
import { DEFAULT_DENY_MESSAGE, PLAN_RESTART_MESSAGE, subagentParent } from '../shared/types.js';
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
 *  tool name can be an agent's title for the call). An underscore inside a
 *  word is left as it is (run_shell_command): only one at a word's edge can
 *  start emphasis. */
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
    .replace(/[\\`*[\]<>#~&]/g, '\\$&')
    .replace(/_(?![A-Za-z0-9])|(?<![A-Za-z0-9])_/g, '\\_');
}

/** A message's text without the blank lines around it. Its first line keeps
 *  its indent, which can make it code. */
function block(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}

type ToolCall = Pick<Extract<AgentEvent, { type: 'assistant_tool_use' }>, 'toolName' | 'toolInput' | 'toolView'>;

/** Each tool call as the thread shows it, by its event: with the updates
 *  applied that fill it in as it runs (ACP agents send its name and input
 *  that way). An update goes to the latest call with its id, as an agent
 *  that restarts can use an id again. */
function toolCalls(events: readonly AgentEvent[]): Map<AgentEvent, ToolCall> {
  const byEvent = new Map<AgentEvent, ToolCall>();
  const latest = new Map<string, ToolCall>();
  for (const e of events) {
    if (e.type === 'assistant_tool_use') {
      const call: ToolCall = { toolName: e.toolName, toolInput: e.toolInput, toolView: e.toolView };
      byEvent.set(e, call);
      latest.set(e.toolUseId, call);
    } else if (e.type === 'tool_update') {
      const call = latest.get(e.toolUseId);
      if (!call) continue;
      if (e.toolName !== undefined) call.toolName = e.toolName;
      if (e.toolInput !== undefined) call.toolInput = e.toolInput;
      if (e.toolView !== undefined) call.toolView = e.toolView;
    }
  }
  return byEvent;
}

/** Replies the app sends for the user when they typed none: not theirs. */
const DEFAULT_REPLIES: ReadonlySet<string> = new Set([DEFAULT_DENY_MESSAGE, PLAN_RESTART_MESSAGE]);

/** The thread as Markdown: a heading per speaker, the messages as written
 *  (they are Markdown already, and are left as they are), and a line per
 *  tool call. */
export function threadMarkdown(events: readonly AgentEvent[], info: ThreadExportInfo, exportedAt: Date): string {
  const calls = toolCalls(events);
  // Who answered each turn: the agent before the first switch, then each
  // switch's new agent (as the handoff transcript does).
  const firstSwitch = events.find((e): e is AgentChanged => e.type === 'agent_changed');
  let agent = firstSwitch?.fromName ?? info.agent;

  /** Paragraphs, joined with a blank line. Tool lines in a row make one
   *  paragraph of lines (not a list, which an agent's own list just above
   *  would take them into). */
  const blocks: string[] = [[
    `# ${plain(info.title)}`,
    '',
    `Project: ${plain(info.project)}  `,
    ...(info.branch ? [`Branch: ${plain(info.branch)}  `] : []),
    `Exported from Grove Bench on ${localDay(exportedAt.getTime())}`,
  ].join('\n')];
  let toolLines = false;
  /** Whose turn the blocks below belong to, so a speaker gets one heading per turn. */
  let section: string | null = null;
  const speak = (who: string) => {
    if (section === who) return;
    section = who;
    blocks.push(`## ${plain(who)}`);
    toolLines = false;
  };
  /** A block from `who`, under their heading. Nothing for an empty one. */
  const say = (who: string, text: string) => {
    if (!text.trim()) return;
    speak(who);
    blocks.push(text);
    toolLines = false;
  };
  const toolLine = (line: string) => {
    speak(agent);
    if (toolLines) blocks[blocks.length - 1] += `  \n${line}`;
    else blocks.push(line);
    toolLines = true;
  };
  /** The last error said, so a turn's result doesn't say it again. */
  let lastError = '';
  const error = (message: string) => {
    const text = plain(message);
    if (!text || text === lastError) return;
    lastError = text;
    say(agent, `> Error: ${text}`);
  };

  for (const e of events) {
    if (subagentParent(e)) continue;
    switch (e.type) {
      case 'user_message': {
        // What was typed, without the contents of attached text files and
        // @-mentioned files, which are sent with it.
        const { typed, names } = userEventParts(e);
        const attached = names.filter(Boolean);
        section = null;
        speak('You');
        say('You', block(typed));
        if (attached.length > 0) say('You', `Attached: ${attached.map(inlineCode).join(', ')}`);
        break;
      }
      case 'assistant_text':
        say(agent, block(e.text));
        break;
      case 'tool_use_summary':
        say(agent, block(e.summary));
        break;
      case 'assistant_tool_use': {
        const call = calls.get(e)!;
        const summary = toolViewSummary(toolViewOf(call));
        toolLine(`→ ${plain(call.toolName)}${summary ? ` ${inlineCode(summary)}` : ''}`);
        break;
      }
      case 'permission_request':
        if (e.planText?.trim()) {
          say(agent, '**Proposed plan:**');
          say(agent, block(e.planText));
        }
        break;
      case 'permission_resolved':
        // A reply the user typed: an answer to the agent's question, or what
        // to change in a plan or why not to run a tool.
        if (e.message && !DEFAULT_REPLIES.has(e.message)) say('You', block(e.message));
        break;
      case 'error':
        error(e.message);
        break;
      case 'result':
        // The reason, when the result has one (Claude Code puts an API error
        // in its text); a failure already reported isn't repeated.
        if (e.isError) error(e.errors?.length ? e.errors.join('; ') : e.result ?? '');
        break;
      case 'agent_changed':
        agent = e.toName;
        section = null;
        blocks.push(`*Switched from ${plain(e.fromName)} to ${plain(e.toName)}.*`);
        toolLines = false;
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
  // Windows keeps these for devices, with any extension too (AUX.ts is AUX),
  // and reads the name before the extension without its trailing spaces.
  const stem = safe.split('.')[0].trimEnd();
  const name = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i.test(stem) ? `Thread ${safe}` : safe;
  return `${name || 'Thread'}.${extension}`;
}
