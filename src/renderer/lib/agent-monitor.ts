/**
 * The agent monitor's rows (AgentMonitorDialog.svelte): for each thread, what
 * its agent is doing, the subagents it is running and the shells it left
 * running, built from what the main window already keeps for the thread. Pure,
 * so it is tested without the stores; agentMonitor.svelte.ts reads them in.
 *
 * Subagents come from the thread's Agent calls. One whose call is still
 * pending runs in the turn: it stops only with the turn (Claude Code's
 * stopTask stops background tasks). One whose call has returned while its
 * task still runs is in the background, and Stop goes to that task.
 */
import type { ChatMessage, ChatToolCallMessage } from '../stores/messages.svelte.js';
import type { BackgroundTask } from '../stores/backgroundTask.svelte.js';
import type { LiveBackgroundTask } from '../../shared/types.js';
import { toolViewOf } from '../../shared/tool-view.js';
import type { AgentSpriteState } from './agent-sprite.js';
import { agentCallInput, isAgentCall } from './message-view.js';
import { toolCallSummary, toolLabel } from './tool-names.js';

/** What a thread or subagent is doing now. */
export type MonitorDoing =
  | { kind: 'tool'; name: string; summary: string; seconds?: number }
  | { kind: 'thinking' }
  | { kind: 'writing' }
  | { kind: 'working' }
  | { kind: 'waiting'; text: string }
  | { kind: 'idle' };

/** A tool call, as the monitor lists it. */
export interface MonitorCall {
  toolUseId: string;
  name: string;
  summary: string;
  isError: boolean;
}

export interface MonitorSubagent {
  /** Its Agent call. */
  toolUseId: string;
  /** Explore, general-purpose, ...; 'subagent' when the call doesn't say. */
  type: string;
  description: string;
  prompt: string;
  /** In the background: the turn isn't waiting on it, and Stop works on it alone. */
  background: boolean;
  /** Its task, for a background one: what Stop goes to. */
  taskId?: string;
  stopping: boolean;
  doing: MonitorDoing;
  /** Its finished tool calls, newest first. */
  recent: MonitorCall[];
  toolUses: number;
  /** From its task, when it has one that has reported. */
  tokens?: number;
  durationMs?: number;
}

export interface MonitorShell {
  taskId: string;
  /** The Monitor tool's watch, or a background shell (a dev server, a watcher). */
  kind: 'shell' | 'monitor';
  description: string;
  stopping: boolean;
}

export interface MonitorThread {
  id: string;
  title: string;
  /** The project's path, which groups the rows: two projects can share a name. */
  repoPath: string;
  project: string;
  branch: string;
  agent: string;
  state: AgentSpriteState;
  /** Its turn is running: Interrupt has something to stop. */
  turnRunning: boolean;
  doing: MonitorDoing;
  /** The thread's own finished tool calls (not its subagents'), newest first. */
  recent: MonitorCall[];
  /** Running subagents only. */
  subagents: MonitorSubagent[];
  shells: MonitorShell[];
}

/** Everything about one thread the monitor reads, gathered from the stores. */
export interface MonitorSource {
  id: string;
  title: string;
  repoPath: string;
  project: string;
  branch: string;
  agent: string;
  state: AgentSpriteState;
  isRunning: boolean;
  activity: { activity: 'thinking' | 'tool_starting' | 'generating' | 'idle'; toolName?: string; toolSummary?: string; elapsedSeconds?: number };
  /** What it waits for you on (the sidebar's line), when it does. */
  waiting: string | null;
  messages: readonly ChatMessage[];
  /** Running tools' elapsed seconds, by toolUseId. */
  progress: Readonly<Record<string, { elapsedSeconds: number }>>;
  tasks: readonly BackgroundTask[];
  /** The agent's live shells and monitors (backgroundTaskStore.runningShells). */
  shells: readonly LiveBackgroundTask[];
}

/** Finished calls kept per thread or subagent. */
export const RECENT_CALLS = 6;

const isToolCall = (m: ChatMessage): m is ChatToolCallMessage => m.kind === 'tool_call';

function asCall(m: ChatToolCallMessage): MonitorCall {
  return { toolUseId: m.toolUseId, name: toolLabel(m.toolName), summary: toolCallSummary(m), isError: !!m.isError };
}

/** The last finished calls under `parent` (undefined: the thread's own). */
function recentCalls(calls: readonly ChatToolCallMessage[], parent: string | undefined): MonitorCall[] {
  const out: MonitorCall[] = [];
  for (let i = calls.length - 1; i >= 0 && out.length < RECENT_CALLS; i--) {
    const c = calls[i];
    if (!c.pending && c.parentToolUseId === parent) out.push(asCall(c));
  }
  return out;
}

function threadDoing(src: MonitorSource): MonitorDoing {
  if (src.waiting) return { kind: 'waiting', text: src.waiting };
  if (!src.isRunning) return { kind: 'idle' };
  const { activity, toolName, toolSummary, elapsedSeconds } = src.activity;
  if (activity === 'tool_starting' && toolName) {
    return { kind: 'tool', name: toolLabel(toolName), summary: toolSummary ?? '', ...(elapsedSeconds ? { seconds: elapsedSeconds } : {}) };
  }
  if (activity === 'thinking') return { kind: 'thinking' };
  if (activity === 'generating') return { kind: 'writing' };
  return { kind: 'working' };
}

function subagentOf(src: MonitorSource, calls: readonly ChatToolCallMessage[], call: ChatToolCallMessage): MonitorSubagent | null {
  const task = src.tasks.find((t) => t.toolUseId === call.toolUseId);
  const taskRunning = task?.status === 'running';
  if (!call.pending && !taskRunning) return null;
  const own = calls.filter((c) => c.parentToolUseId === call.toolUseId);
  const current = own.findLast((c) => c.pending);
  const seconds = current ? src.progress[current.toolUseId]?.elapsedSeconds : undefined;
  const { agentType, prompt } = agentCallInput(call);
  const background = !call.pending && taskRunning;
  return {
    toolUseId: call.toolUseId,
    type: agentType ?? 'subagent',
    description: toolViewOf(call).summary || task?.description || 'Subagent',
    prompt: prompt ?? '',
    background,
    ...(background && task ? { taskId: task.taskId } : {}),
    stopping: !!task?.stopping,
    doing: current
      ? { kind: 'tool', name: toolLabel(current.toolName), summary: toolCallSummary(current), ...(seconds ? { seconds } : {}) }
      : { kind: 'working' },
    recent: recentCalls(own, call.toolUseId),
    toolUses: Math.max(own.length, task?.toolUses ?? 0),
    ...(task?.totalTokens ? { tokens: task.totalTokens } : {}),
    ...(task?.durationMs ? { durationMs: task.durationMs } : {}),
  };
}

const MONITOR_TASK_TYPES = new Set(['monitor_mcp', 'monitor_ws']);

export function monitorThread(src: MonitorSource): MonitorThread {
  const calls = src.messages.filter(isToolCall);
  const subagents = calls
    .filter(isAgentCall)
    .map((c) => subagentOf(src, calls, c))
    .filter((a): a is MonitorSubagent => a !== null);
  return {
    id: src.id,
    title: src.title,
    repoPath: src.repoPath,
    project: src.project,
    branch: src.branch,
    agent: src.agent,
    state: src.state,
    turnRunning: src.isRunning,
    doing: threadDoing(src),
    recent: recentCalls(calls, undefined),
    subagents,
    shells: src.shells.map((sh) => ({
      taskId: sh.taskId,
      kind: sh.shellKind === 'monitor' || (!!sh.taskType && MONITOR_TASK_TYPES.has(sh.taskType)) ? 'monitor' : 'shell',
      description: sh.description,
      stopping: !!src.tasks.find((t) => t.taskId === sh.taskId)?.stopping,
    })),
  };
}

/** Something is running or waiting on the user: what the Running filter keeps. */
export function isActive(t: MonitorThread): boolean {
  return t.turnRunning || t.doing.kind === 'waiting' || t.subagents.length > 0 || t.shells.length > 0;
}

/** The text the filter box searches: names, tools, files, subagents, shells. */
export function searchText(t: MonitorThread): string {
  const doing = (d: MonitorDoing) => (d.kind === 'tool' ? `${d.name} ${d.summary}` : d.kind === 'waiting' ? d.text : '');
  return [
    t.title, t.project, t.branch, t.agent, doing(t.doing),
    ...t.subagents.flatMap((a) => [a.type, a.description, doing(a.doing)]),
    ...t.shells.map((sh) => sh.description),
  ].join('\n').toLowerCase();
}
