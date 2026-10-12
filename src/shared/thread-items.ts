/**
 * What a thread holds besides its messages: the agent's to-do list as it
 * stands now, and the files that came into the thread (the ones you
 * attached, images tools returned, files the agent made). The status bar's
 * Tasks and Files chips show them.
 *
 * Main builds them from the whole event log, since the renderer only holds
 * the pages of history it has loaded and a to-do list can start long before
 * the latest page. Event indexes are in the prelaunch-prefixed space the
 * renderer pages over, so they feed the same jump to a message that search
 * and bookmarks use.
 *
 * To-do lists come three ways:
 * - Claude Code's TodoWrite, and OpenCode's todowrite over ACP: the whole
 *   list in `todos`, each call replacing the last.
 * - Claude Code's TaskCreate and TaskUpdate: one task at a time. TaskCreate's
 *   id is only in its result ("Task #3 created successfully: ..."), so tasks
 *   change when the result comes back, and not when the call failed.
 * - An ACP agent's plan, which the ACP adapter reports as a `plan` call whose
 *   input is the whole list (`entries`), updated in place as it changes.
 */
import { attachedFilesFromSent } from './prompt-text.js';
import { subagentParent, type AgentEvent, type MadeFile, type StoredFile, type StoredImage } from './types.js';

export type ThreadTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface ThreadTask {
  /** The agent's id for the task (TaskCreate's), else its place in the list. */
  id: string;
  content: string;
  /** What it says while the task is in progress ("Running tests"), when the
   *  agent gives that. */
  activeForm?: string;
  status: ThreadTaskStatus;
}

/** A file in the thread, at the event it came in with (the latest, when the
 *  same file came in more than once). */
export type ThreadFile =
  /** An image you attached, or one a tool returned. */
  | { kind: 'image'; from: 'user' | 'tool'; image: StoredImage; toolName?: string; eventIndex: number }
  /** A text file you attached. It went inside the message, so it has no
   *  saved copy: its content is in that message's text. */
  | { kind: 'text'; name: string; size: number; eventIndex: number }
  /** Any other file you attached (a PDF, audio), saved in the attachments folder. */
  | { kind: 'file'; file: StoredFile; eventIndex: number }
  /** A file the agent made in its worktree during a turn. */
  | { kind: 'made'; made: MadeFile; eventIndex: number };

export interface ThreadItems {
  tasks: ThreadTask[];
  /** The event that last changed the to-do list, or null when there is none. */
  tasksEventIndex: number | null;
  /** Newest first. */
  files: ThreadFile[];
}

export const EMPTY_THREAD_ITEMS: ThreadItems = { tasks: [], tasksEventIndex: null, files: [] };

/** How TaskCreate's result names the task it made. */
const TASK_CREATED_RE = /Task #(\S+) created successfully/;
/** How TaskUpdate's result starts. */
const TASK_UPDATED_RE = /^Updated task #/;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function taskStatus(value: unknown): ThreadTaskStatus {
  return value === 'in_progress' || value === 'completed' || value === 'cancelled' ? value : 'pending';
}

/**
 * The whole to-do list a call carries, or null when it carries none: the
 * `todos` of a to-do tool (TodoWrite, todowrite) or an ACP plan's `entries`.
 * An empty list is a list: the agent cleared it.
 */
export function taskListOf(toolName: string, toolInput: unknown): ThreadTask[] | null {
  const input = rec(toolInput);
  const items = /todo/i.test(toolName) && Array.isArray(input.todos) ? input.todos
    : toolName === 'plan' && Array.isArray(input.entries) ? input.entries
    : null;
  if (!items) return null;
  const tasks: ThreadTask[] = [];
  for (const [i, raw] of items.entries()) {
    const item = rec(raw);
    const content = str(item.content);
    if (!content) continue;
    const activeForm = str(item.activeForm);
    tasks.push({
      id: str(item.id) ?? String(i),
      content,
      ...(activeForm ? { activeForm } : {}),
      status: taskStatus(item.status),
    });
  }
  return tasks;
}

/** Whether an input carries a whole list (for tool_update, which often
 *  leaves the name out). */
function hasTaskList(toolInput: unknown): boolean {
  const input = rec(toolInput);
  return Array.isArray(input.todos) || Array.isArray(input.entries);
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** One key per file, so a file that comes in again is listed once: an image
 *  by its saved copy (named by a hash of its bytes), a text file by its name,
 *  a file the agent made by its path. */
export function threadFileKey(f: ThreadFile): string {
  switch (f.kind) {
    case 'image': return `image:${f.image.file}`;
    case 'text': return `text:${f.name}`;
    case 'file': return `file:${f.file.file}`;
    case 'made': return `made:${f.made.path}`;
  }
}

/** The thread's to-do list and files, from its event log. */
export function threadItems(events: readonly AgentEvent[]): ThreadItems {
  let tasks: ThreadTask[] = [];
  let tasksEventIndex: number | null = null;
  /** Tool names by call id: a tool_update may leave its name out. */
  const toolNames = new Map<string, string>();
  /** Calls a subagent made, whose updates are its own. */
  const subagentCalls = new Set<string>();
  /** TaskCreate and TaskUpdate calls waiting on their results. */
  const taskCalls = new Map<string, { toolName: string; input: Record<string, unknown> }>();
  /** By a key per file, so a file that comes in again moves to its latest
   *  event (Map keeps insertion order; delete then set moves it last). */
  const files = new Map<string, ThreadFile>();
  const addFile = (file: ThreadFile) => {
    const key = threadFileKey(file);
    files.delete(key);
    files.set(key, file);
  };
  const setTasks = (next: ThreadTask[], at: number) => {
    tasks = next;
    tasksEventIndex = at;
  };

  for (const [i, event] of events.entries()) {
    // A subagent keeps its own TodoWrite list, and its files show in its own
    // thread. Claude Code's tasks are one list the subagents share, so their
    // TaskCreate and TaskUpdate calls count.
    const subagent = subagentParent(event) !== undefined;
    switch (event.type) {
      case 'assistant_tool_use': {
        toolNames.set(event.toolUseId, event.toolName);
        if (event.toolName === 'TaskCreate' || event.toolName === 'TaskUpdate') {
          taskCalls.set(event.toolUseId, { toolName: event.toolName, input: rec(event.toolInput) });
          break;
        }
        if (subagent) {
          subagentCalls.add(event.toolUseId);
          break;
        }
        const list = taskListOf(event.toolName, event.toolInput);
        if (list) setTasks(list, i);
        break;
      }
      case 'tool_update': {
        if (event.toolName) toolNames.set(event.toolUseId, event.toolName);
        const name = toolNames.get(event.toolUseId);
        if (!name || subagentCalls.has(event.toolUseId) || !hasTaskList(event.toolInput)) break;
        const list = taskListOf(name, event.toolInput);
        if (list) setTasks(list, i);
        break;
      }
      case 'tool_result': {
        const call = taskCalls.get(event.toolUseId);
        if (call) {
          taskCalls.delete(event.toolUseId);
          if (!event.isError) {
            const next = applyTaskCall(tasks, call.toolName, call.input, event.content);
            if (next) setTasks(next, i);
          }
        }
        if (subagent) break;
        for (const image of event.images ?? []) {
          const toolName = toolNames.get(event.toolUseId);
          addFile({ kind: 'image', from: 'tool', image, ...(toolName ? { toolName } : {}), eventIndex: i });
        }
        break;
      }
      case 'user_message': {
        for (const sent of attachedFilesFromSent(event.text).files) {
          addFile({ kind: 'text', name: sent.path, size: byteLength(sent.content), eventIndex: i });
        }
        for (const image of event.images ?? []) {
          addFile({ kind: 'image', from: 'user', image, eventIndex: i });
        }
        for (const file of event.files ?? []) {
          addFile({ kind: 'file', file, eventIndex: i });
        }
        break;
      }
      case 'files_made': {
        for (const made of event.files) {
          addFile({ kind: 'made', made, eventIndex: i });
        }
        break;
      }
    }
  }

  return { tasks, tasksEventIndex, files: [...files.values()].reverse() };
}

/** The list after a TaskCreate or TaskUpdate that succeeded, or null when it
 *  changed nothing the list shows. */
function applyTaskCall(
  tasks: ThreadTask[],
  toolName: string,
  input: Record<string, unknown>,
  result: string,
): ThreadTask[] | null {
  if (toolName === 'TaskCreate') {
    const id = TASK_CREATED_RE.exec(result)?.[1];
    const content = str(input.subject);
    if (!id || !content) return null;
    const activeForm = str(input.activeForm);
    const task: ThreadTask = { id, content, ...(activeForm ? { activeForm } : {}), status: 'pending' };
    return [...tasks.filter((t) => t.id !== id), task];
  }
  const id = str(input.taskId);
  const at = id ? tasks.findIndex((t) => t.id === id) : -1;
  if (at < 0) return null;
  if (input.status === 'deleted') return tasks.filter((_, j) => j !== at);
  const before = tasks[at];
  const subject = str(input.subject);
  const activeForm = str(input.activeForm);
  const after: ThreadTask = {
    ...before,
    ...(subject ? { content: subject } : {}),
    ...(activeForm ? { activeForm } : {}),
    ...(input.status !== undefined ? { status: taskStatus(input.status) } : {}),
  };
  return tasks.map((t, j) => (j === at ? after : t));
}

/**
 * Whether a live event may change what threadItems gives, so the renderer
 * asks main again. Cheap, and generous where unsure: a refresh that finds
 * nothing new costs one call. A rewind or /clear (the agent starts again with
 * system_init) cuts the history, so both count.
 */
export function touchesThreadItems(event: AgentEvent): boolean {
  switch (event.type) {
    case 'assistant_tool_use':
      return taskListOf(event.toolName, event.toolInput) !== null;
    case 'tool_update':
      return hasTaskList(event.toolInput);
    case 'tool_result':
      return !!event.images?.length || TASK_CREATED_RE.test(event.content) || TASK_UPDATED_RE.test(event.content);
    case 'user_message':
    case 'files_made':
    case 'rewind':
    case 'system_init':
      return true;
    default:
      return false;
  }
}

/** How many tasks count toward the total (a cancelled one doesn't), and how
 *  many of those are done. */
export function taskProgress(tasks: readonly ThreadTask[]): { done: number; total: number } {
  const counted = tasks.filter((t) => t.status !== 'cancelled');
  return { done: counted.filter((t) => t.status === 'completed').length, total: counted.length };
}
