/**
 * The Summary view's turns (ThreadTurn): a thread split into each prompt and
 * what followed it, and what a turn's work comes to (its steps, the files it
 * changed, its commands and the ones that passed on a retry). Detailed and
 * Focus draw the thread as rows instead (message-view.ts).
 */
import { diffArrays } from 'diff';
import type { ChatMessage } from '../stores/messages.svelte.js';
import { actsOutsideProject, isAgentCall, isMessageVisible } from './message-view.js';
import { toolViewOf, type ToolView } from '../../shared/tool-view.js';

type UserMessage = Extract<ChatMessage, { kind: 'user' }>;
type ResultMessage = Extract<ChatMessage, { kind: 'result' }>;

/** A prompt that starts a turn: the user's own message, not one steered into
 *  a running turn (that one is part of the turn it was read in). */
export function isPrompt(msg: ChatMessage): msg is UserMessage {
  return msg.kind === 'user' && !msg.steer;
}

/**
 * What Summary draws of a thread: every message of each turn (a turn's work
 * folds into its card instead of being left out), and before the first
 * prompt, what Summary always showed.
 */
export function turnViewMessages(thread: ChatMessage[]): ChatMessage[] {
  const first = thread.findIndex(isPrompt);
  return thread.filter((m, i) => isMessageVisible(m, first >= 0 && i >= first ? 'detailed' : 'summary'));
}

/** One prompt and the messages after it, up to the next prompt. */
export interface Turn {
  /** The prompt's id, or `continued:` and the first message's for a turn
   *  whose prompt isn't drawn (it's in an older page). */
  id: string;
  prompt?: UserMessage;
  /** The messages after the prompt, in order. */
  msgs: ChatMessage[];
  /** How the turn ended: its cost and time. None while it runs, or when it
   *  was cut off. */
  result?: ResultMessage;
}

/** A run of rows drawn as they are (before the first prompt), or a turn. */
export type ThreadGroup =
  | { kind: 'rows'; id: string; msgs: ChatMessage[] }
  | { kind: 'turn'; turn: Turn };

/**
 * The drawn messages in turns. `continuesTurn`: the first of them comes after
 * a prompt that isn't drawn, so they open with the rest of that turn.
 */
export function groupTurns(drawn: readonly ChatMessage[], continuesTurn: boolean): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  let turn: Turn | null = null;
  let rows: ChatMessage[] | null = null;
  for (const msg of drawn) {
    if (isPrompt(msg)) {
      turn = { id: msg.id, prompt: msg, msgs: [] };
      groups.push({ kind: 'turn', turn });
      rows = null;
      continue;
    }
    if (!turn && continuesTurn && groups.length === 0) {
      turn = { id: `continued:${msg.id}`, msgs: [] };
      groups.push({ kind: 'turn', turn });
    }
    if (turn) {
      turn.msgs.push(msg);
      if (msg.kind === 'result') turn.result = msg;
      continue;
    }
    if (!rows) {
      rows = [];
      groups.push({ kind: 'rows', id: `rows:${msg.id}`, msgs: rows });
    }
    rows.push(msg);
  }
  return groups;
}

/** Waits for the user: a permission, question, MCP form or limit not yet answered. */
function waitsForUser(msg: ChatMessage): boolean {
  return (msg.kind === 'permission' || msg.kind === 'question' || msg.kind === 'elicitation' || msg.kind === 'limit') && !msg.resolved;
}

/** Where a turn stands: `ended` is a turn with no result that isn't running
 *  (cut off, or history without one). */
export type TurnStatus = 'working' | 'attention' | 'done' | 'error' | 'ended';

/** `live`: the thread's last turn, while the agent runs it. */
export function turnStatus(turn: Turn, live: boolean): TurnStatus {
  if (live) return turn.msgs.some(waitsForUser) ? 'attention' : 'working';
  if (turn.result?.isError || turn.msgs.some((m) => m.kind === 'error')) return 'error';
  return turn.result ? 'done' : 'ended';
}

/**
 * Whether a message is part of a turn's work, which the card folds behind
 * its work strip: tool calls, thinking, notes written while working
 * (narrationIds), answered permissions and plain status lines. The rest
 * stays in view: the answer, anything that waits for you or went wrong, your
 * own words, each subagent's line (shown in every view), and tools that may
 * act outside the project, such as an MCP server's (actsOutsideProject).
 */
export function isWorkStep(msg: ChatMessage, notes: ReadonlySet<string>): boolean {
  switch (msg.kind) {
    case 'tool_call': return !isAgentCall(msg) && !actsOutsideProject(msg);
    case 'thinking': return true;
    case 'text': return notes.has(msg.id);
    case 'permission': return msg.resolved;
    case 'system': return msg.level !== 'warning';
    default: return false;
  }
}

/** A step of work that shows the images its tool returned while the work is
 *  folded: they're output to look at, as Focus shows them. */
export function showsImagesFolded(msg: ChatMessage): boolean {
  return msg.kind === 'tool_call' && !isAgentCall(msg) && !!msg.images?.length;
}

/** A command linked to another run of the same command in its turn: a
 *  failure to the run that passed after it, and that run back to the
 *  failure. */
export interface RetryLink {
  kind: 'passed' | 'retry-of';
  /** The other run's message id. */
  to: string;
}

/**
 * The commands that failed and then passed when run again (the same command,
 * later in the turn), by message id. Each failure links to the run that
 * passed; that run links back to the last failure before it.
 */
export function retryLinks(msgs: readonly ChatMessage[]): Map<string, RetryLink> {
  const links = new Map<string, RetryLink>();
  const failed = new Map<string, string[]>();
  for (const msg of msgs) {
    if (msg.kind !== 'tool_call' || msg.pending || msg.result === undefined) continue;
    const view = toolViewOf(msg);
    const command = view.kind === 'shell' ? view.command?.trim() : undefined;
    if (!command) continue;
    if (msg.isError) {
      const ids = failed.get(command);
      if (ids) ids.push(msg.id);
      else failed.set(command, [msg.id]);
      continue;
    }
    const ids = failed.get(command);
    if (!ids) continue;
    for (const id of ids) links.set(id, { kind: 'passed', to: msg.id });
    links.set(msg.id, { kind: 'retry-of', to: ids[ids.length - 1] });
    failed.delete(command);
  }
  return links;
}

/** What a turn's work comes to, for its summary line. */
export interface TurnTally {
  /** Distinct files read. */
  filesRead: number;
  searches: number;
  /** Lines added and removed in each file changed, in the order first changed. */
  edits: Map<string, { add: number; del: number }>;
  add: number;
  del: number;
  commands: number;
  failed: number;
  /** Failed commands that passed when run again (retryLinks). */
  passedOnRetry: number;
  /** Other tools: web fetches and searches, MCP tools. */
  other: number;
}

/** Tool kinds that aren't counted as steps: a question shows as its own
 *  block, and a subagent as its line. */
const NOT_A_STEP: ReadonlySet<ToolView['kind']> = new Set(['question', 'agent']);

export function tallyTurn(msgs: readonly ChatMessage[], links: ReadonlyMap<string, RetryLink>): TurnTally {
  const tally: TurnTally = {
    filesRead: 0, searches: 0, edits: new Map(), add: 0, del: 0,
    commands: 0, failed: 0, passedOnRetry: 0, other: 0,
  };
  const read = new Set<string>();
  for (const msg of msgs) {
    if (msg.kind !== 'tool_call') continue;
    const view = toolViewOf(msg);
    if (NOT_A_STEP.has(view.kind)) continue;
    switch (view.kind) {
      case 'read':
        if (view.path) read.add(view.path);
        break;
      case 'search':
        tally.searches++;
        break;
      case 'edit': {
        const path = view.path ?? msg.toolName;
        const { add, del } = editLineCounts(msg, view);
        const file = tally.edits.get(path);
        if (file) { file.add += add; file.del += del; } else tally.edits.set(path, { add, del });
        tally.add += add;
        tally.del += del;
        break;
      }
      case 'shell': {
        tally.commands++;
        if (msg.isError && !msg.pending) {
          tally.failed++;
          if (links.get(msg.id)?.kind === 'passed') tally.passedOnRetry++;
        }
        break;
      }
      default:
        tally.other++;
    }
  }
  tally.filesRead = read.size;
  return tally;
}

const lineCounts = new WeakMap<ChatMessage, { add: number; del: number }>();

/**
 * Lines an edit adds and removes, each replacement diffed line by line
 * (lineChanges). A whole-file write counts as all added: the old content
 * isn't known.
 */
export function editLineCounts(msg: ChatMessage, view: ToolView): { add: number; del: number } {
  const known = lineCounts.get(msg);
  if (known) return known;
  let add = 0;
  let del = 0;
  if (view.edits?.length) {
    for (const e of view.edits) {
      const c = lineChanges(e.oldText, e.newText);
      add += c.add;
      del += c.del;
    }
  } else if (view.write) {
    add = splitLines(view.write).length;
  }
  const counts = { add, del };
  lineCounts.set(msg, counts);
  return counts;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  // A final newline ends the last line rather than starting another.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** A replacement this long on either side isn't diffed (trimmedChange
 *  counts it instead), and no diff runs longer than DIFF_MS: the counts are
 *  worked out for every edit in view, while the window waits. */
const DIFF_MAX_LINES = 400;
const DIFF_MS = 15;

/** Lines a replacement adds and removes: diffed, or for a long one, or one
 *  that takes too long, counted by trimmedChange. */
export function lineChanges(oldText: string, newText: string): { add: number; del: number } {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length <= DIFF_MAX_LINES && b.length <= DIFF_MAX_LINES) {
    const parts = diffArrays(a, b, { timeout: DIFF_MS });
    if (parts) {
      let add = 0;
      let del = 0;
      for (const part of parts) {
        if (part.added) add += part.value.length;
        else if (part.removed) del += part.value.length;
      }
      return { add, del };
    }
  }
  return trimmedChange(a, b);
}

/**
 * A replacement's lines, less those it starts and ends with unchanged. Exact
 * for a change in one place, which most replacements are; one that changes
 * two places apart counts the lines between them too, so it can count more
 * than changed.
 */
function trimmedChange(a: string[], b: string[]): { add: number; del: number } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { add: endB - start, del: endA - start };
}

/** How long a turn took: "41s", "3m 12s", "1h 5m". */
export function formatTurnTime(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Which turns start folded to one line: finished ones before the last two.
 * A turn still running, or waiting for you, never does.
 */
export function foldsByDefault(index: number, count: number, status: TurnStatus): boolean {
  return index < count - 2 && status !== 'working' && status !== 'attention';
}
