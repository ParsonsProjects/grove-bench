import type { AgentEvent, LiveBackgroundTask } from '../../shared/types.js';

export interface BackgroundTask {
  taskId: string;
  /** The tool call that started it (for a subagent, its Agent call). */
  toolUseId?: string;
  description: string;
  taskType?: string;
  summary?: string;
  lastToolName?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  /** A stop request is in flight; cleared when the task ends or the request fails. */
  stopping?: boolean;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

/** Auto-remove delay for finished tasks (ms). */
const AUTO_REMOVE_MS = 3000;

/** Task types that are an agent at work: a subagent, or a workflow run here
 *  or remotely. Not a background shell ('local_bash'): that can be a dev
 *  server that never ends. */
const AGENT_TASK_TYPES = new Set(['local_agent', 'local_workflow', 'remote_agent']);

/** Task types that are a command left running: a background shell (a dev
 *  server, a watcher) or a monitor. The Monitor tool's watch command is a
 *  local_bash task too; monitor_mcp and monitor_ws watch an MCP server or a
 *  socket. */
const SHELL_TASK_TYPES = new Set(['local_bash', 'monitor_mcp', 'monitor_ws']);

const isShellType = (taskType: string | undefined): boolean => !!taskType && SHELL_TASK_TYPES.has(taskType);

/** No shells: one shared empty list, so a thread without any keeps the same one. */
export const NO_SHELLS: readonly LiveBackgroundTask[] = Object.freeze([]);

/**
 * Tracks Task-tool background work per session. Owns only task state; the
 * system messages announcing task lifecycle are pushed by MessageStore, which
 * is the single owner of the message list.
 */
class BackgroundTaskStore {
  tasksBySession = $state<Record<string, Record<string, BackgroundTask>>>({});

  /** The shells and monitors in the agent's latest list of its live
   *  background tasks, per session (background_tasks_changed, or main's copy
   *  after a replay: setLive). Unlike tasksBySession it holds no foreground
   *  task (one the turn waits on), nor one an observer of the agent's
   *  started. Each list is set only when the agent's set changes, so a row
   *  that reads it runs again only then, not on every progress update. */
  shellsBySession = $state<Record<string, readonly LiveBackgroundTask[]>>({});

  /** Pending auto-remove timers per session, so they can be cancelled on destroy. */
  private timers = new Map<string, Set<ReturnType<typeof setTimeout>>>();

  /** The threads with a background agent running, as one string: each
   *  progress update replaces a thread's tasks, and this way what reads
   *  hasRunningAgent (the sidebar's counts) only runs again when the set
   *  itself changes. */
  private agentThreadKey = $derived.by(() =>
    Object.keys(this.tasksBySession).filter((id) => this.runningAgents(id).length > 0).sort().join('\n'));
  private agentThreads = $derived(new Set(this.agentThreadKey ? this.agentThreadKey.split('\n') : []));

  get(sessionId: string): BackgroundTask[] {
    return Object.values(this.tasksBySession[sessionId] ?? {});
  }

  /** Whether the task a tool call started is still running: a background
   *  subagent works on after its Agent call has returned. */
  isRunningFor(sessionId: string, toolUseId: string): boolean {
    return this.get(sessionId).some((t) => t.toolUseId === toolUseId && t.status === 'running');
  }

  /** The background agents still running: subagents and workflows that work
   *  on after the turn that started them ended. The thread counts as working
   *  while there are any and its agent is up (see thread-working.ts). */
  runningAgents(sessionId: string): BackgroundTask[] {
    return this.get(sessionId).filter((t) => t.status === 'running' && !!t.taskType && AGENT_TASK_TYPES.has(t.taskType));
  }

  /** Whether the thread has a background agent running (see runningAgents). */
  hasRunningAgent(sessionId: string): boolean {
    return this.agentThreads.has(sessionId);
  }

  /** The background shells and monitors the agent says are running (see
   *  shellsBySession). The sidebar reads them through backgroundShells
   *  (lib/background-shells.ts), which counts them only while the agent is up. */
  runningShells(sessionId: string): readonly LiveBackgroundTask[] {
    return this.shellsBySession[sessionId] ?? NO_SHELLS;
  }

  /** The tasks the status bar lists as background tasks: every one but a
   *  running shell or monitor the agent's live list doesn't hold, which is a
   *  foreground one the turn waits on (or an observer's), so it agrees with
   *  the sidebar. */
  listed(sessionId: string): BackgroundTask[] {
    const shells = this.runningShells(sessionId);
    return this.get(sessionId).filter((t) =>
      t.status !== 'running' || !isShellType(t.taskType) || shells.some((s) => s.taskId === t.taskId));
  }

  /** Take the agent's live list of its background tasks (replace semantics):
   *  from background_tasks_changed, or the copy main sends with a history
   *  page, which may not reach back to the event that listed them. */
  setLive(sessionId: string, tasks: readonly LiveBackgroundTask[]): void {
    const shells = tasks.filter((t) => isShellType(t.taskType) && !t.observerOwned);
    if (shells.length === 0) this.dropShells(sessionId);
    else this.shellsBySession[sessionId] = shells;
  }

  /** Forget the session's shells, replacing the record only when it has some,
   *  so every other row that reads it doesn't run again for nothing. */
  private dropShells(sessionId: string): void {
    if (!(sessionId in this.shellsBySession)) return;
    const { [sessionId]: _gone, ...rest } = this.shellsBySession;
    this.shellsBySession = rest;
  }

  /** Remove a completed/failed/stopped background task from the list */
  remove(sessionId: string, taskId: string): void {
    const tasks = this.tasksBySession[sessionId];
    if (!tasks?.[taskId]) return;
    const { [taskId]: _, ...rest } = tasks;
    this.tasksBySession[sessionId] = rest;
  }

  start(sessionId: string, event: Extract<AgentEvent, { type: 'task_started' }>): void {
    const tasks = this.tasksBySession[sessionId] ?? {};
    tasks[event.taskId] = {
      taskId: event.taskId,
      toolUseId: event.toolUseId,
      description: event.description,
      // The live list can come first, and may be the one that has the type.
      taskType: event.taskType ?? tasks[event.taskId]?.taskType,
      status: 'running',
      totalTokens: 0,
      toolUses: 0,
      durationMs: 0,
    };
    this.tasksBySession[sessionId] = { ...tasks };
  }

  /**
   * Ask the main process to stop one running task. The task stays listed as
   * running (with `stopping` set) until the SDK's task_notification arrives.
   * Rethrows so the caller can surface the failure.
   */
  async stop(sessionId: string, taskId: string): Promise<void> {
    const task = this.tasksBySession[sessionId]?.[taskId];
    if (!task || task.status !== 'running' || task.stopping) return;
    this.setStopping(sessionId, taskId, true);
    try {
      await window.groveBench.stopBackgroundTask(sessionId, taskId);
    } catch (err) {
      this.setStopping(sessionId, taskId, false);
      throw err;
    }
  }

  private setStopping(sessionId: string, taskId: string, stopping: boolean): void {
    const tasks = this.tasksBySession[sessionId];
    const task = tasks?.[taskId];
    if (!task) return;
    this.tasksBySession[sessionId] = { ...tasks, [taskId]: { ...task, stopping } };
  }

  /**
   * Apply the SDK's authoritative live-task list (replace semantics): running
   * tasks it no longer lists are dropped, unknown ones it lists are added.
   * Finished tasks are left alone; their auto-remove timer handles them.
   */
  reconcile(sessionId: string, event: Extract<AgentEvent, { type: 'background_tasks_changed' }>): void {
    const tasks = this.tasksBySession[sessionId] ?? {};
    const live = new Map(event.tasks.map((t) => [t.taskId, t]));
    const next: Record<string, BackgroundTask> = {};
    for (const [id, task] of Object.entries(tasks)) {
      const listed = live.get(id);
      if (listed && !task.taskType && listed.taskType) next[id] = { ...task, taskType: listed.taskType };
      else if (task.status !== 'running' || listed) next[id] = task;
    }
    for (const [id, t] of live) {
      if (next[id]) continue;
      next[id] = {
        taskId: id,
        description: t.description,
        taskType: t.taskType,
        status: 'running',
        totalTokens: 0,
        toolUses: 0,
        durationMs: 0,
      };
    }
    this.tasksBySession[sessionId] = next;
    this.setLive(sessionId, event.tasks);
  }

  progress(sessionId: string, event: Extract<AgentEvent, { type: 'task_progress' }>): void {
    const tasks = this.tasksBySession[sessionId] ?? {};
    const existing = tasks[event.taskId];
    tasks[event.taskId] = {
      ...(existing ?? { taskId: event.taskId, status: 'running' }),
      toolUseId: event.toolUseId ?? existing?.toolUseId,
      description: event.description,
      summary: event.summary,
      lastToolName: event.lastToolName,
      totalTokens: event.totalTokens,
      toolUses: event.toolUses,
      durationMs: event.durationMs,
    };
    this.tasksBySession[sessionId] = { ...tasks };
  }

  /**
   * Apply a terminal notification and schedule the finished task's auto-removal.
   * Returns the label + text for the system message MessageStore should push.
   */
  notify(
    sessionId: string,
    event: Extract<AgentEvent, { type: 'task_notification' }>,
  ): { label: 'completed' | 'failed' | 'stopped'; text: string } {
    const tasks = this.tasksBySession[sessionId] ?? {};
    const prev = tasks[event.taskId];
    tasks[event.taskId] = {
      ...(prev ?? { taskId: event.taskId, description: '' }),
      status: event.taskStatus,
      stopping: false,
      summary: event.summary,
      totalTokens: event.totalTokens ?? prev?.totalTokens ?? 0,
      toolUses: event.toolUses ?? prev?.toolUses ?? 0,
      durationMs: event.durationMs ?? prev?.durationMs ?? 0,
    };
    this.tasksBySession[sessionId] = { ...tasks };
    const label = event.taskStatus === 'completed' ? 'completed' : event.taskStatus === 'failed' ? 'failed' : 'stopped';
    const text = event.summary || prev?.description || event.taskId;

    // Auto-remove finished tasks after a short delay
    const taskId = event.taskId;
    let timers = this.timers.get(sessionId);
    if (!timers) { timers = new Set(); this.timers.set(sessionId, timers); }
    const timer = setTimeout(() => {
      timers.delete(timer);
      this.remove(sessionId, taskId);
    }, AUTO_REMOVE_MS);
    timers.add(timer);

    return { label, text };
  }

  /**
   * Remove tasks still marked 'running' once the agent process is gone (exit
   * or history replay of a dead session): `agentLive` false. Not called on a
   * plain turn result: background tasks legitimately outlive the turn that
   * started them, and an interrupt spares them (perTaskStopAffordance), so
   * they must stay listed while the agent is up.
   */
  resolveStale(sessionId: string, agentLive: boolean): void {
    if (agentLive) return;
    this.dropShells(sessionId);
    const tasks = this.tasksBySession[sessionId];
    if (!tasks) return;
    const remaining: Record<string, BackgroundTask> = {};
    let changed = false;
    for (const [id, task] of Object.entries(tasks)) {
      if (task.status === 'running') {
        changed = true; // drop stale running tasks
      } else {
        remaining[id] = task;
      }
    }
    if (changed) {
      this.tasksBySession[sessionId] = Object.keys(remaining).length > 0 ? remaining : {};
    }
  }

  /** Clear task state for a session that stays alive (e.g. history replay). */
  clear(sessionId: string): void {
    const { [sessionId]: _drop, ...rest } = this.tasksBySession;
    this.tasksBySession = rest;
    this.dropShells(sessionId);
  }

  /** Cancel pending timers and drop all state for a destroyed session. */
  destroy(sessionId: string): void {
    const timers = this.timers.get(sessionId);
    if (timers) {
      for (const t of timers) clearTimeout(t);
      this.timers.delete(sessionId);
    }
    this.clear(sessionId);
  }
}

export const backgroundTaskStore = new BackgroundTaskStore();
