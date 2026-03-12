import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { OrchJob, OrchTask, OrchCreateOpts, OrchEvent, OrchJobStatus, OrchTaskStatus } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { decompose } from './decomposer.js';
import { git } from './git.js';
import { logger } from './logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

interface ManagedOrchJob {
  job: OrchJob;
  window: BrowserWindow;
  spawnTask?: (task: OrchTask) => Promise<void>;
  spawnReady?: () => OrchTask[];
}

const PERSISTENCE_FILE = path.join(app.getPath('userData'), 'worktrees', 'orchestration.json');

class Orchestrator {
  private jobs = new Map<string, ManagedOrchJob>();

  private emit(managed: ManagedOrchJob, event: OrchEvent) {
    const { job, window: win } = managed;
    logger.debug(`[orch] job=${job.id} event=${event.type}`);
    if (!win.isDestroyed()) {
      win.webContents.send(`${IPC.ORCH_EVENT}:${job.id}`, event);
    }
  }

  private updateJobStatus(managed: ManagedOrchJob, status: OrchJobStatus) {
    managed.job.status = status;
    if (status === 'completed' || status === 'failed' || status === 'partial_failure' || status === 'cancelled') {
      managed.job.completedAt = Date.now();
    }
    this.emit(managed, { type: 'orch_job_status', jobId: managed.job.id, status });
    this.persist();
  }

  private updateTaskStatus(managed: ManagedOrchJob, taskId: string, status: OrchTaskStatus, error?: string) {
    const task = managed.job.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.status = status;
    if (error) task.error = error;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      task.completedAt = Date.now();
    }
    this.emit(managed, { type: 'orch_task_status', jobId: managed.job.id, taskId, status, error });
    this.persist();
  }

  async createJob(opts: OrchCreateOpts, window: BrowserWindow): Promise<{ jobId: string }> {
    const jobId = `orch_${randomUUID().slice(0, 8)}`;
    const jobIdShort = jobId.slice(5); // strip "orch_"

    // Determine base branch
    let baseBranch = opts.baseBranch;
    if (!baseBranch) {
      baseBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], opts.repoPath)).trim();
    }

    const job: OrchJob = {
      id: jobId,
      repoPath: opts.repoPath,
      goal: opts.goal,
      baseBranch,
      tasks: [],
      status: 'planning',
      createdAt: Date.now(),
      completedAt: null,
      planDurationMs: null,
      totalCostUsd: null,
    };

    const managed: ManagedOrchJob = { job, window };
    this.jobs.set(jobId, managed);

    // Return immediately so the renderer can subscribe to events before decomposition starts
    // Decomposition runs in the background
    setImmediate(() => {
      this.emit(managed, { type: 'orch_plan_start', jobId });
      const planStart = Date.now();
      decompose(opts.goal, opts.repoPath, baseBranch, jobIdShort)
        .then((tasks) => {
          for (const task of tasks) {
            task.jobId = jobId;
            task.baseBranch = baseBranch;
          }
          job.tasks = tasks;
          job.planDurationMs = Date.now() - planStart;
          job.status = 'planned';
          this.emit(managed, { type: 'orch_plan_complete', jobId, tasks });
          this.persist();
        })
        .catch((err) => {
          const errMsg = (err as Error).message || String(err);
          logger.error(`[orch] Decomposition failed for job ${jobId}:`, err);
          job.status = 'failed';
          job.planDurationMs = Date.now() - planStart;
          this.emit(managed, { type: 'orch_plan_error', jobId, error: errMsg });
          this.persist();
        });
    });

    return { jobId };
  }

  async approvePlan(jobId: string, editedTasks?: Partial<OrchTask>[]): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);
    if (managed.job.status !== 'planned') {
      throw new Error(`Job ${jobId} is not in 'planned' state (current: ${managed.job.status})`);
    }

    // Apply user edits if provided
    if (editedTasks) {
      for (const edit of editedTasks) {
        if (!edit.id) continue;
        const task = managed.job.tasks.find((t) => t.id === edit.id);
        if (!task) continue;
        if (edit.instruction !== undefined) task.instruction = edit.instruction;
        if (edit.description !== undefined) task.description = edit.description;
        if (edit.branchName !== undefined) task.branchName = edit.branchName;
      }
    }

    this.updateJobStatus(managed, 'spawning');
    // Spawn tasks (don't await — run in background)
    this.spawnTasks(managed).catch((err) => {
      logger.error(`[orch] spawnTasks failed for job ${jobId}:`, err);
      this.updateJobStatus(managed, 'failed');
    });
  }

  private async spawnTasks(managed: ManagedOrchJob) {
    const { job } = managed;

    // Determine which tasks are ready (no unfinished dependencies)
    const spawnReady = () => {
      return job.tasks.filter((t) => {
        if (t.status !== 'pending') return false;
        return t.dependsOn.every((depId) => {
          const dep = job.tasks.find((d) => d.id === depId);
          return dep?.status === 'completed';
        });
      });
    };

    const spawnTask = async (task: OrchTask) => {
      this.updateTaskStatus(managed, task.id, 'spawning');

      try {
        // Create worktree
        const worktree = await worktreeManager.create({
          repoPath: job.repoPath,
          branchName: task.branchName,
          baseBranch: task.baseBranch,
        });

        // Copy untracked files
        try {
          const config = await worktreeManager.getRepoConfig(job.repoPath);
          if (config.copyFiles.length > 0) {
            await worktreeManager.copyUntrackedFiles(worktree.id, config.copyFiles);
          }
        } catch { /* non-fatal */ }

        // Create session
        const session = await sessionManager.createSession({
          id: worktree.id,
          branch: worktree.branch,
          cwd: worktree.path,
          repoPath: job.repoPath,
          window: managed.window,
        });

        task.sessionId = session.id;
        this.updateTaskStatus(managed, task.id, 'running');

        // Register completion callback BEFORE sending to avoid race
        sessionManager.onComplete(session.id, (result) => {
          this.handleTaskComplete(managed, task, result);
        });

        // Wait for system_init before sending the instruction
        await this.waitForReady(session.id, 30_000);

        // Send the task instruction
        sessionManager.sendMessage(session.id, task.instruction);
      } catch (err) {
        const errMsg = (err as Error).message || String(err);
        logger.error(`[orch] Failed to spawn task ${task.id}:`, err);
        this.updateTaskStatus(managed, task.id, 'failed', errMsg);
        this.checkJobCompletion(managed);
      }
    };

    // Initial spawn of all ready tasks
    this.updateJobStatus(managed, 'running');
    const ready = spawnReady();
    if (ready.length === 0 && job.tasks.every((t) => t.status === 'pending')) {
      // All tasks have unsatisfied deps — shouldn't happen after validation
      this.updateJobStatus(managed, 'failed');
      return;
    }
    await Promise.all(ready.map(spawnTask));

    // Store for dependent task spawning and retries
    managed.spawnTask = spawnTask;
    managed.spawnReady = spawnReady;
  }

  private waitForReady(sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Session init timeout')), timeoutMs);
      const check = () => {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          clearTimeout(timer);
          reject(new Error('Session was destroyed before becoming ready'));
          return;
        }
        if ((session as any).status === 'running') {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  private handleTaskComplete(
    managed: ManagedOrchJob,
    task: OrchTask,
    result: { sessionId: string; isError: boolean; totalCostUsd?: number; durationMs?: number },
  ) {
    if (result.isError) {
      this.updateTaskStatus(managed, task.id, 'failed', 'Agent encountered an error');
    } else {
      task.costUsd = result.totalCostUsd ?? null;
      this.updateTaskStatus(managed, task.id, 'completed');
    }

    // Try to spawn dependent tasks
    const { spawnReady, spawnTask } = managed;
    if (spawnReady && spawnTask) {
      const ready = spawnReady();
      for (const t of ready) {
        spawnTask(t).catch((err) => {
          logger.error(`[orch] Failed to spawn dependent task ${t.id}:`, err);
          this.updateTaskStatus(managed, t.id, 'failed', (err as Error).message);
        });
      }
    }

    // Cancel tasks whose dependencies failed
    for (const t of managed.job.tasks) {
      if (t.status !== 'pending') continue;
      const hasFailed = t.dependsOn.some((depId) => {
        const dep = managed.job.tasks.find((d) => d.id === depId);
        return dep?.status === 'failed';
      });
      if (hasFailed) {
        this.updateTaskStatus(managed, t.id, 'cancelled', 'Dependency failed');
      }
    }

    this.checkJobCompletion(managed);
  }

  private checkJobCompletion(managed: ManagedOrchJob) {
    const { tasks } = managed.job;
    const allDone = tasks.every((t) =>
      t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );
    if (!allDone) return;

    const allCompleted = tasks.every((t) => t.status === 'completed');
    const allFailed = tasks.every((t) => t.status === 'failed' || t.status === 'cancelled');

    // Sum costs
    managed.job.totalCostUsd = tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

    if (allCompleted) {
      this.updateJobStatus(managed, 'completed');
    } else if (allFailed) {
      this.updateJobStatus(managed, 'failed');
    } else {
      this.updateJobStatus(managed, 'partial_failure');
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    // Destroy all running sessions
    for (const task of managed.job.tasks) {
      if (task.sessionId && (task.status === 'running' || task.status === 'spawning')) {
        try {
          await sessionManager.destroySession(task.sessionId);
        } catch { /* best effort */ }
        this.updateTaskStatus(managed, task.id, 'cancelled');
      } else if (task.status === 'pending') {
        this.updateTaskStatus(managed, task.id, 'cancelled');
      }
    }

    this.updateJobStatus(managed, 'cancelled');
  }

  async retryTask(jobId: string, taskId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    const task = managed.job.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error(`Task ${taskId} is not in a retryable state`);
    }

    // Destroy old session/worktree if they exist
    if (task.sessionId) {
      try {
        await sessionManager.destroySession(task.sessionId);
        await worktreeManager.remove(task.sessionId);
      } catch { /* best effort */ }
      task.sessionId = null;
    }

    // Reset task state
    task.status = 'pending';
    task.error = null;
    task.completedAt = null;
    task.costUsd = null;

    // Update job status back to running
    if (managed.job.status !== 'running') {
      this.updateJobStatus(managed, 'running');
    }

    // If spawnTask doesn't exist (e.g., after persistence reload), re-init spawn infra
    if (!managed.spawnTask) {
      this.spawnTasks(managed).catch((err) => {
        logger.error(`[orch] Retry spawnTasks failed for job ${jobId}:`, err);
        this.updateJobStatus(managed, 'failed');
      });
      return;
    }

    managed.spawnTask(task).catch((err) => {
      logger.error(`[orch] Retry spawn failed for task ${taskId}:`, err);
      this.updateTaskStatus(managed, taskId, 'failed', (err as Error).message);
      this.checkJobCompletion(managed);
    });
  }

  listJobs(): OrchJob[] {
    return [...this.jobs.values()].map((m) => m.job);
  }

  getJob(jobId: string): OrchJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  // ─── Persistence ───

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private persist() {
    // Debounce: coalesce rapid status updates into a single write
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.doPersist();
    }, 500);
  }

  private async doPersist() {
    try {
      const dir = path.dirname(PERSISTENCE_FILE);
      await fs.mkdir(dir, { recursive: true });
      const data: Record<string, OrchJob> = {};
      for (const [id, managed] of this.jobs) {
        data[id] = managed.job;
      }
      await fs.writeFile(PERSISTENCE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.warn('[orch] Failed to persist orchestration state:', err);
    }
  }

  async loadPersistedJobs(window: BrowserWindow) {
    try {
      const raw = await fs.readFile(PERSISTENCE_FILE, 'utf-8');
      const data = JSON.parse(raw) as Record<string, OrchJob>;
      for (const [id, job] of Object.entries(data)) {
        // Mark any previously running tasks as failed (app restarted)
        for (const task of job.tasks) {
          if (task.status === 'running' || task.status === 'spawning') {
            task.status = 'failed';
            task.error = 'App restarted during execution';
            task.completedAt = Date.now();
          }
        }
        // Recalculate job status
        const allDone = job.tasks.every((t) =>
          t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
        );
        if (allDone && job.status === 'running') {
          const allCompleted = job.tasks.every((t) => t.status === 'completed');
          job.status = allCompleted ? 'completed' : 'partial_failure';
          job.completedAt = Date.now();
        }

        this.jobs.set(id, { job, window });
      }
      if (Object.keys(data).length > 0) {
        logger.info(`[orch] Loaded ${Object.keys(data).length} persisted orchestration jobs`);
      }
    } catch {
      // File doesn't exist or is invalid — that's fine
    }
  }

  async cleanup() {
    // Cancel all running jobs
    for (const [, managed] of this.jobs) {
      if (managed.job.status === 'running' || managed.job.status === 'spawning') {
        for (const task of managed.job.tasks) {
          if (task.status === 'running' || task.status === 'spawning') {
            task.status = 'failed';
            task.error = 'App shutting down';
            task.completedAt = Date.now();
          }
        }
        managed.job.status = 'failed';
        managed.job.completedAt = Date.now();
      }
    }
    // Flush immediately on cleanup (bypass debounce)
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.doPersist();
  }
}

export const orchestrator = new Orchestrator();
