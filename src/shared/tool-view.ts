/**
 * What a tool call does, in terms every agent shares: the file it reads or
 * edits, the command it runs, the page it fetches. The UI and the read-only
 * classifier work from this view instead of a provider's tool names and
 * input fields (Claude Code's `Edit` with `file_path`/`old_string`, an ACP
 * agent's `edit` call with a `diff`).
 *
 * Adapters attach a view to tool events (`toolView`) when their tools are
 * not Claude Code's. Events without one are read with `claudeToolView`:
 * Claude Code is the agent every conversation saved before this view
 * existed ran on, and the Claude adapter leaves it off so saved history
 * doesn't carry every edit twice.
 */
import type { ToolCategory } from './types.js';

export type ToolKind =
  /** Changes a file: `edits` and/or `write` say how. */
  | 'edit'
  /** Reads a file (or lists a directory) at `path`. */
  | 'read'
  /** Searches files for `pattern` under `path`. */
  | 'search'
  /** Runs `command` in a shell. */
  | 'shell'
  /** Fetches the web page at `url`. */
  | 'fetch'
  /** Searches the web for `query`. */
  | 'web_search'
  /** Asks the user a question. */
  | 'question'
  /** Hands work to a sub-agent. */
  | 'agent'
  /** Presents a plan for approval. */
  | 'plan'
  | 'other';

/** One replacement in a file: `oldText` becomes `newText`. */
export interface ToolTextEdit {
  oldText: string;
  newText: string;
}

/** A question an agent puts to the user, with the answers it offers. */
export interface ToolQuestion {
  question: string;
  /** A short label for the question, e.g. "Database". */
  header?: string;
  options: Array<{ label: string; description?: string }>;
  /** More than one option may be picked. */
  multiSelect?: boolean;
}

export interface ToolView {
  kind: ToolKind;
  /** The file the call reads, edits or searches, as the agent gave it. */
  path?: string;
  /** Further files the call touches, when it names more than one. */
  morePaths?: string[];
  /** Replacements within `path`. */
  edits?: ToolTextEdit[];
  /** The whole new content of `path`: a new file, or one replaced outright. */
  write?: string;
  command?: string;
  pattern?: string;
  url?: string;
  query?: string;
  /** A short line saying what the call does, for tools the fields above
   *  don't describe (an agent-written title, a sub-agent's task). */
  summary?: string;
  /** The MCP server and tool, when the call is to an MCP tool the agent
   *  names as one. ACP doesn't mark MCP calls, so other agents' often have
   *  none. */
  mcp?: { server: string; tool: string };
  /** For 'question': what is asked, and the answers offered. */
  questions?: ToolQuestion[];
  /** For 'agent': the kind of sub-agent, and the task it was given. */
  agentType?: string;
  prompt?: string;
}

function str(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = input[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

function textEdits(raw: unknown): ToolTextEdit[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolTextEdit[] = [];
  for (const e of raw) {
    if (e && typeof e === 'object') {
      const rec = e as Record<string, unknown>;
      out.push({ oldText: String(rec.old_string ?? ''), newText: String(rec.new_string ?? '') });
    }
  }
  return out;
}

/** A short summary from common input field names, for tools the view
 *  doesn't otherwise describe. */
function genericSummary(input: Record<string, unknown>): string | undefined {
  const s = str(input, 'description', 'prompt', 'query', 'url', 'file_path', 'path', 'command', 'pattern');
  return s ? s.slice(0, 120) : undefined;
}

/** `mcp__<server>__<tool>` → its server and tool. */
export function claudeMcpTool(toolName: string): { server: string; tool: string } | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep > 0 && sep + 2 < rest.length ? { server: rest.slice(0, sep), tool: rest.slice(sep + 2) } : undefined;
}

/** AskUserQuestion's `questions`, keeping only well-formed entries. */
function questionsOf(value: unknown): ToolQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: ToolQuestion[] = [];
  for (const raw of value) {
    const q = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    if (typeof q.question !== 'string') continue;
    const options = Array.isArray(q.options) ? q.options.flatMap((o) => {
      const opt = (o && typeof o === 'object') ? o as Record<string, unknown> : {};
      return typeof opt.label === 'string'
        ? [{ label: opt.label, ...(typeof opt.description === 'string' ? { description: opt.description } : {}) }]
        : [];
    }) : [];
    out.push({
      question: q.question,
      ...(typeof q.header === 'string' ? { header: q.header } : {}),
      options,
      ...(q.multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  return out;
}

/**
 * The view of a Claude Code tool call. Also the reading of any tool event
 * that carries no `toolView` (see the module comment).
 */
export function claudeToolView(toolName: string, toolInput: unknown): ToolView {
  const input = (toolInput && typeof toolInput === 'object') ? toolInput as Record<string, unknown> : {};
  const path = str(input, 'file_path', 'filePath');
  switch (toolName) {
    case 'Edit':
      return {
        kind: 'edit',
        path,
        edits: [{ oldText: String(input.old_string ?? ''), newText: String(input.new_string ?? '') }],
      };
    case 'MultiEdit':
      return { kind: 'edit', path, edits: textEdits(input.edits) };
    case 'Write':
      return { kind: 'edit', path, write: String(input.content ?? '') };
    case 'NotebookEdit':
      return { kind: 'edit', path: str(input, 'notebook_path') };
    case 'Read':
      return { kind: 'read', path };
    case 'NotebookRead':
      return { kind: 'read', path: str(input, 'notebook_path') };
    case 'LS':
      return { kind: 'read', path: str(input, 'path') };
    case 'TodoRead':
      return { kind: 'read' };
    case 'Grep':
    case 'Glob':
      return { kind: 'search', pattern: str(input, 'pattern'), path: str(input, 'path') };
    case 'Bash':
    case 'PowerShell':
      return { kind: 'shell', command: typeof input.command === 'string' ? input.command : '' };
    case 'WebFetch':
      return { kind: 'fetch', url: str(input, 'url') };
    case 'WebSearch':
      return { kind: 'web_search', query: str(input, 'query') };
    case 'AskUserQuestion':
      return { kind: 'question', questions: questionsOf(input.questions) };
    case 'Agent':
    case 'Task': {
      const agentType = str(input, 'subagent_type');
      const prompt = str(input, 'prompt');
      return {
        kind: 'agent',
        summary: str(input, 'description', 'prompt')?.slice(0, 120),
        ...(agentType ? { agentType } : {}),
        ...(prompt ? { prompt } : {}),
      };
    }
    case 'ExitPlanMode':
      return { kind: 'plan' };
    default: {
      const mcp = claudeMcpTool(toolName);
      if (toolName.startsWith('mcp__') && toolName.includes('WebFetch')) {
        return { kind: 'fetch', url: str(input, 'url'), ...(mcp ? { mcp } : {}) };
      }
      return { kind: 'other', summary: genericSummary(input), ...(mcp ? { mcp } : {}) };
    }
  }
}

/** A tool event's view: the one its adapter attached, else Claude Code's reading. */
export function toolViewOf(call: { toolName: string; toolInput: unknown; toolView?: ToolView }): ToolView {
  return call.toolView ?? claudeToolView(call.toolName, call.toolInput);
}

/** The permission-rule category a view falls in (see TOOL_RULE_KEYWORDS). */
export function categoryForView(view: ToolView): ToolCategory {
  switch (view.kind) {
    case 'edit': return 'edit';
    case 'read':
    case 'search': return 'read';
    case 'shell': return 'bash';
    case 'fetch': return 'web_fetch';
    case 'question': return 'question';
    case 'agent': return 'agent';
    default: return 'other';
  }
}

/** Whether a call changes files or runs commands, so the git status may
 *  have moved and Summary view keeps it in sight. `category` covers calls
 *  whose view lacks the detail, such as a command an agent only titled. */
export function changesFiles(view: ToolView, category?: ToolCategory): boolean {
  return view.kind === 'edit' || view.kind === 'shell' || category === 'edit' || category === 'bash';
}

/** One line saying what a call works on: the command, file, pattern (before
 *  the folder, for a search), URL or summary. Empty when the view has none. */
export function toolViewSummary(view: ToolView): string {
  const target = view.kind === 'search' ? view.pattern ?? view.path : view.path ?? view.pattern;
  return view.command ?? target ?? view.url ?? view.query ?? view.summary ?? '';
}
