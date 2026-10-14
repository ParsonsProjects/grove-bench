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

/** `text` as inline code, on one line, with a fence it can't close early. */
function inlineCode(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const line = firstLine.length < text.trimEnd().length ? `${firstLine} …` : firstLine;
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

/** The thread as Markdown: a heading per speaker, the messages as written
 *  (they are Markdown already), and a line per tool call. */
export function threadMarkdown(events: readonly AgentEvent[], info: ThreadExportInfo, exportedAt: Date): string {
  // Who answered each turn: the agent before the first switch, then each
  // switch's new agent (as the handoff transcript does).
  const firstSwitch = events.find((e): e is AgentChanged => e.type === 'agent_changed');
  let agent = firstSwitch?.fromName ?? info.agent;

  const out: string[] = [
    `# ${info.title}`,
    '',
    `Project: ${info.project}  `,
    `Branch: ${info.branch}  `,
    `Exported from Grove Bench on ${localDay(exportedAt.getTime())}`,
  ];
  /** Whose section the lines below belong to, so a speaker gets one heading per turn. */
  let section: string | null = null;
  const speak = (who: string) => {
    if (section === who) return;
    section = who;
    out.push('', `## ${who}`, '');
  };

  for (const e of events) {
    if (subagentParent(e)) continue;
    switch (e.type) {
      case 'user_message': {
        section = null;
        speak('You');
        out.push(e.text.trim());
        const attached = [...(e.images ?? []), ...(e.files ?? [])].map((a) => a.name).filter(Boolean);
        if (attached.length > 0) out.push('', `Attached: ${attached.join(', ')}`);
        break;
      }
      case 'assistant_text':
        if (!e.text.trim()) break;
        speak(agent);
        // Blank lines around it, or after a tool call it would read as part
        // of that list item.
        out.push('', e.text.trim(), '');
        break;
      case 'assistant_tool_use': {
        speak(agent);
        const summary = toolViewSummary(toolViewOf(e));
        out.push(`- ${e.toolName}${summary ? ` ${inlineCode(summary)}` : ''}`);
        break;
      }
      case 'error':
        speak(agent);
        out.push('', `> Error: ${e.message.trim().replace(/\r?\n/g, ' ')}`, '');
        break;
      case 'agent_changed':
        agent = e.toName;
        section = null;
        out.push('', `*Switched from ${e.fromName} to ${e.toName}.*`);
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
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
  const name = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? `Thread ${safe}` : safe;
  return `${name || 'Thread'}.${extension}`;
}
