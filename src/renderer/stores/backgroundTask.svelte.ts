import type { AgentEvent } from '../../shared/types.js';

export interface BackgroundTask {
  taskId: string;
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

/**
 * Tracks Task-tool background work per session. Owns only task state; the
 * system messages announcing task lifecycle are pushed by MessageStore, which
 * is the single owner of the message list.
 */
class BackgroundTaskStore {
  tasksBySession = $state<Record<string, Record<string, BackgroundTask>>>({});

  /** Pending auto-remove timers per session, so they can be cancelled on destroy. */
  private timers = new Map<string, Set<ReturnType<typeof setTimeout>>>();

  get(sessionId: string): BackgroundTask[] {
    return Object.values(this.tasksBySession[sessionId] ?? {});
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
      description: event.description,
      taskType: event.taskType,
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
      if (task.status !== 'running' || live.has(id)) next[id] = task;
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
  }

  progress(sessionId: string, event: Extract<AgentEvent, { type: 'task_progress' }>): void {
    const tasks = this.tasksBySession[sessionId] ?? {};
    const existing = tasks[event.taskId];
    tasks[event.taskId] = {
      ...(existing ?? { taskId: event.taskId, status: 'running' }),
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
      timers!.delete(timer);
      this.remove(sessionId, taskId);
    }, AUTO_REMOVE_MS);
    timers.add(timer);

    return { label, text };
  }

  /**
   * Remove tasks still marked 'running' once the agent process is gone (exit
   * or history replay of a dead session). Not called on a plain turn result:
   * background tasks legitimately outlive the turn that started them, and an
   * interrupt spares them (perTaskStopAffordance), so they must stay listed.
   */
  resolveStale(sessionId: string, isRunning: boolean): void {
    if (isRunning) return;
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
