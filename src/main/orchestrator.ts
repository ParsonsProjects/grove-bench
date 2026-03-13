import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { OrchJob, OrchTask, OrchCreateOpts, OrchEvent, OrchJobStatus, OrchTaskStatus } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { validateTasks, detectOverlaps, decompose, DECOMPOSE_SCHEMA } from './decomposer.js';
import { git, mergeNoCommit, abortMerge } from './git.js';
import { logger } from './logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

const SPAWN_STAGGER_MS = 2500;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface ManagedOrchJob {
  job: OrchJob;
  window: BrowserWindow;
  spawnTask?: (task: OrchTask) => Promise<void>;
  spawnReady?: () => OrchTask[];
}

const PERSISTENCE_FILE = path.join(app.getPath('userData'), 'worktrees', 'orchestration.json');

class Orchestrator {
  private jobs = new Map<string, ManagedOrchJob>();
  private taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    this.persistNow();
  }

  private updateTaskStatus(managed: ManagedOrchJob, taskId: string, status: OrchTaskStatus, error?: string) {
    const task = managed.job.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.status = status;
    if (error) task.error = error;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      task.completedAt = Date.now();
      if (task.startedAt) {
        task.durationMs = Date.now() - task.startedAt;
      }
    }
    this.emit(managed, { type: 'orch_task_status', jobId: managed.job.id, taskId, status, error });
    this.persist();
  }

  // ─── Task Timeout Management ───

  private startTaskTimer(managed: ManagedOrchJob, task: OrchTask) {
    const timeoutMs = task.timeoutMs ?? managed.job.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) return; // no timeout

    const timer = setTimeout(async () => {
      this.taskTimers.delete(task.id);
      logger.warn(`[orch] Task ${task.id} timed out after ${timeoutMs}ms`);

      if (task.sessionId) {
        try {
          await sessionManager.destroySession(task.sessionId);
        } catch { /* best effort */ }
      }

      this.updateTaskStatus(managed, task.id, 'failed', `Task timed out after ${Math.round(timeoutMs / 1000)}s`);
      this.emit(managed, { type: 'orch_task_timeout', jobId: managed.job.id, taskId: task.id });

      // Cancel dependents and check completion
      this.cancelDependents(managed);
      this.checkJobCompletion(managed);
    }, timeoutMs);

    this.taskTimers.set(task.id, timer);
  }

  private clearTaskTimer(taskId: string) {
    const timer = this.taskTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
  }

  private clearAllTimers(job: OrchJob) {
    for (const task of job.tasks) {
      this.clearTaskTimer(task.id);
    }
  }

  // ─── Circuit Breaker ───

  private checkCircuitBreaker(managed: ManagedOrchJob): boolean {
    const threshold = managed.job.circuitBreakerThreshold;
    if (threshold === null || threshold === undefined) return false;

    const failedCount = managed.job.tasks.filter(t => t.status === 'failed').length;
    const totalCount = managed.job.tasks.length;

    if (totalCount > 0 && failedCount / totalCount >= threshold) {
      logger.warn(`[orch] Circuit breaker triggered for job ${managed.job.id}: ${failedCount}/${totalCount} failed`);
      this.emit(managed, { type: 'orch_circuit_breaker', jobId: managed.job.id, failedCount, totalCount });

      for (const task of managed.job.tasks) {
        if (task.status === 'pending' || task.status === 'running' || task.status === 'spawning') {
          this.clearTaskTimer(task.id);
          if (task.sessionId && (task.status === 'running' || task.status === 'spawning')) {
            sessionManager.destroySession(task.sessionId).catch(() => {});
          }
          this.updateTaskStatus(managed, task.id, 'cancelled', 'Circuit breaker triggered');
        }
      }
      return true;
    }
    return false;
  }

  // ─── Job Creation ───

  async createJob(opts: OrchCreateOpts, window: BrowserWindow): Promise<{ jobId: string; planSessionId: string }> {
    const jobId = `orch_${randomUUID().slice(0, 8)}`;
    const jobIdShort = jobId.slice(5); // strip "orch_"
    const planSessionId = `plan_${jobId}`;

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
      planSessionId,
      overlapWarnings: [],
      mergeResults: [],
      mergeWorktreeId: null,
      defaultTimeoutMs: opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      circuitBreakerThreshold: opts.circuitBreakerThreshold ?? null,
    };

    const managed: ManagedOrchJob = { job, window };
    this.jobs.set(jobId, managed);

    const branchPrefix = `orch/${jobIdShort}`;

    const orchSystemPrompt = `You are a TASK DECOMPOSER, not a coding assistant. Your ONLY job is to analyze the codebase and break the user's goal into 2-5 independent sub-tasks for parallel execution by separate AI coding agents.

CRITICAL RULES:
- Do NOT write any code, implement anything, or make any changes
- Do NOT create files, edit files, or run commands other than reading files to understand the codebase
- You MAY use Read, Glob, Grep, and Bash (read-only commands like ls, find, cat) to explore the codebase
- Your ONLY output should be analysis followed by a JSON task array

WORKFLOW:
1. Read the codebase structure (file listing, key files, README, etc.)
2. Understand the architecture and how the goal maps to the codebase
3. Decompose the goal into 2-5 independent, parallelizable tasks
4. Output the task array as a fenced JSON code block

Branch prefix for all tasks: ${branchPrefix}

OUTPUT FORMAT — you MUST end your response with exactly this:
\`\`\`json
[{
  "description": "short description of the task",
  "branchName": "${branchPrefix}/descriptive-branch-name",
  "scope": ["src/file1.ts", "src/dir/"],
  "priority": 1,
  "parallelizable": true,
  "dependsOn": [],
  "instruction": "Detailed, self-contained instruction for the agent. Include specific file paths, function names, and expected behavior. The agent will have NO other context besides this instruction and the codebase."
}]
\`\`\`

TASK DESIGN RULES:
- Each task must be self-contained — an agent should be able to complete it with ONLY the instruction text and the codebase
- Minimize file overlap between tasks (agents work in isolated git worktrees and changes are merged later)
- Branch names must be valid git branch names (use hyphens, prefix with ${branchPrefix}/)
- dependsOn references task IDs: task_1, task_2, etc. (assigned in array order)
- Set parallelizable: false only if a task truly cannot start until another finishes
- Instructions should be specific: mention exact file paths, function signatures, and expected behavior`;

    await sessionManager.createSession({
      id: planSessionId,
      branch: `orch: ${opts.goal.slice(0, 40)}`,
      cwd: opts.repoPath,
      repoPath: opts.repoPath,
      window,
      permissionMode: 'acceptEdits',
      orchJobId: jobId,
      customSystemPrompt: orchSystemPrompt,
      // Only allow read-only tools — the decomposer must not write code
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'ListDir'],
      // Force structured JSON output matching the task schema
      outputFormat: { type: 'json_schema', schema: DECOMPOSE_SCHEMA },
    });

    const planStart = Date.now();
    let planHandled = false;

    // Listen for result events — multi-turn sessions don't fire onComplete
    // until the stream closes, so we react to each result event instead.
    sessionManager.onEvent(planSessionId, (event) => {
      const ev = event as any;
      if (ev.type === 'result') {
        logger.info(`[orch] Plan session result: isError=${ev.isError}, hasStructuredOutput=${!!ev.structured_output}, hasResult=${!!ev.result}, planHandled=${planHandled}`);
        if (!ev.isError && !planHandled) {
          planHandled = true;
          this.handlePlanComplete(managed, ev, branchPrefix, baseBranch, planStart)
            .catch((err) => {
              logger.error(`[orch] handlePlanComplete failed:`, err);
              managed.job.status = 'failed';
              this.emit(managed, { type: 'orch_plan_error', jobId: managed.job.id, error: (err as Error).message });
              this.persistNow();
            });
        } else if (ev.isError && !planHandled) {
          planHandled = true;
          managed.job.planDurationMs = Date.now() - planStart;
          managed.job.status = 'failed';
          this.emit(managed, { type: 'orch_plan_error', jobId: managed.job.id, error: 'Planning agent failed' });
          this.persistNow();
        }
      }
    });

    sessionManager.sendMessage(planSessionId, opts.goal);
    logger.info(`[orch] Created orchestrator session ${planSessionId} for job ${jobId}`);
    this.persist();

    return { jobId, planSessionId };
  }

  private async handlePlanComplete(
    managed: ManagedOrchJob,
    resultEvent: any,
    branchPrefix: string,
    baseBranch: string,
    planStart: number,
  ) {
    const { job } = managed;
    job.planDurationMs = Date.now() - planStart;

    try {
      let raw: import('./decomposer.js').RawTask[] | null = null;

      // 1. Try structured_output from the result event
      if (resultEvent.structured_output) {
        const so = resultEvent.structured_output;
        logger.info(`[orch] structured_output type=${typeof so}, isArray=${Array.isArray(so)}, keys=${typeof so === 'object' && so ? Object.keys(so).join(',') : 'N/A'}`);
        raw = Array.isArray(so) ? so : so.tasks;
      }

      // 2. Fallback: extract JSON from result text
      if (!raw && resultEvent.result) {
        logger.info(`[orch] Falling back to text extraction, result length=${resultEvent.result.length}`);
        let jsonStr = resultEvent.result;
        const fenceMatches = [...jsonStr.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)];
        if (fenceMatches.length > 0) {
          jsonStr = fenceMatches[fenceMatches.length - 1][1];
        }
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }
        const parsed = JSON.parse(jsonStr.trim());
        raw = Array.isArray(parsed) ? parsed : parsed.tasks;
      }

      if (!raw || !Array.isArray(raw)) {
        logger.error(`[orch] raw is invalid: ${JSON.stringify(raw).slice(0, 200)}`);
        throw new Error('Planning agent returned no valid task array');
      }

      logger.info(`[orch] Parsed ${raw.length} raw tasks, validating...`);
      const tasks = validateTasks(raw, branchPrefix);

      for (const task of tasks) {
        task.jobId = job.id;
        task.baseBranch = baseBranch;
      }

      // Detect overlapping scopes
      const warnings = detectOverlaps(tasks);
      job.overlapWarnings = warnings;

      job.tasks = tasks;
      job.status = 'planned';
      this.emit(managed, { type: 'orch_plan_complete', jobId: job.id, tasks });

      if (warnings.length > 0) {
        this.emit(managed, { type: 'orch_overlap_warning', jobId: job.id, warnings });
        logger.warn(`[orch] Job ${job.id}: ${warnings.length} overlap warning(s) detected`);
      }

      logger.info(`[orch] Plan complete for job ${job.id}: ${tasks.length} tasks`);
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      logger.error(`[orch] Failed to parse plan result for job ${job.id}:`, err);
      job.status = 'failed';
      this.emit(managed, { type: 'orch_plan_error', jobId: job.id, error: errMsg });
    }

    this.persistNow();
  }

  // ─── Plan Approval & Task Spawning ───

  async approvePlan(jobId: string, editedTasks?: Partial<OrchTask>[]): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);
    if (managed.job.status !== 'planned') {
      throw new Error(`Job ${jobId} is not in 'planned' state (current: ${managed.job.status})`);
    }

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
    this.spawnTasks(managed).catch((err) => {
      logger.error(`[orch] spawnTasks failed for job ${jobId}:`, err);
      this.updateJobStatus(managed, 'failed');
    });
  }

  private async spawnTasks(managed: ManagedOrchJob) {
    const { job } = managed;

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
        const worktree = await worktreeManager.create({
          repoPath: job.repoPath,
          branchName: task.branchName,
          baseBranch: task.baseBranch,
        });

        try {
          const config = await worktreeManager.getRepoConfig(job.repoPath);
          if (config.copyFiles.length > 0) {
            await worktreeManager.copyUntrackedFiles(worktree.id, config.copyFiles);
          }
        } catch { /* non-fatal */ }

        const session = await sessionManager.createSession({
          id: worktree.id,
          branch: worktree.branch,
          cwd: worktree.path,
          repoPath: job.repoPath,
          window: managed.window,
          parentSessionId: job.planSessionId,
        });

        task.sessionId = session.id;
        task.startedAt = Date.now();
        this.updateTaskStatus(managed, task.id, 'running');

        // Start timeout timer
        this.startTaskTimer(managed, task);

        this.emit(managed, {
          type: 'orch_task_session',
          jobId: job.id,
          taskId: task.id,
          sessionId: session.id,
          branch: worktree.branch,
          repoPath: job.repoPath,
          parentSessionId: job.planSessionId!,
        });

        sessionManager.onComplete(session.id, (result) => {
          this.handleTaskComplete(managed, task, result);
        });

        // Subscribe to agent events for progress updates
        sessionManager.onEvent(session.id, (event) => {
          if (event.type === 'activity' && event.activity === 'tool_starting' && event.toolName) {
            this.emit(managed, {
              type: 'orch_task_progress',
              jobId: job.id,
              taskId: task.id,
              summary: `Using ${event.toolName}`,
            });
          }
        });

        sessionManager.sendMessage(session.id, task.instruction);
      } catch (err) {
        const errMsg = (err as Error).message || String(err);
        logger.error(`[orch] Failed to spawn task ${task.id}:`, err);
        this.updateTaskStatus(managed, task.id, 'failed', errMsg);
        this.checkJobCompletion(managed);
      }
    };

    // Initial spawn with stagger
    this.updateJobStatus(managed, 'running');
    const ready = spawnReady();
    if (ready.length === 0 && job.tasks.every((t) => t.status === 'pending')) {
      this.updateJobStatus(managed, 'failed');
      return;
    }

    // Stagger spawning to reduce resource contention
    for (let i = 0; i < ready.length; i++) {
      if (i > 0) {
        await new Promise(r => setTimeout(r, SPAWN_STAGGER_MS));
      }
      // Fire-and-forget (don't await individual spawns)
      spawnTask(ready[i]).catch((err) => {
        logger.error(`[orch] Failed to spawn task ${ready[i].id}:`, err);
        this.updateTaskStatus(managed, ready[i].id, 'failed', (err as Error).message);
      });
    }

    managed.spawnTask = spawnTask;
    managed.spawnReady = spawnReady;
  }

  private handleTaskComplete(
    managed: ManagedOrchJob,
    task: OrchTask,
    result: { sessionId: string; isError: boolean; totalCostUsd?: number; durationMs?: number },
  ) {
    // Clear timeout timer
    this.clearTaskTimer(task.id);

    if (result.isError) {
      this.updateTaskStatus(managed, task.id, 'failed', 'Agent encountered an error');
    } else {
      task.costUsd = result.totalCostUsd ?? null;
      this.updateTaskStatus(managed, task.id, 'completed');
    }

    // Check circuit breaker before spawning more
    if (this.checkCircuitBreaker(managed)) {
      this.checkJobCompletion(managed);
      return;
    }

    // Spawn dependent tasks with stagger
    const { spawnReady, spawnTask } = managed;
    if (spawnReady && spawnTask) {
      const ready = spawnReady();
      const spawnWithStagger = async () => {
        for (let i = 0; i < ready.length; i++) {
          if (i > 0) {
            await new Promise(r => setTimeout(r, SPAWN_STAGGER_MS));
          }
          spawnTask(ready[i]).catch((err) => {
            logger.error(`[orch] Failed to spawn dependent task ${ready[i].id}:`, err);
            this.updateTaskStatus(managed, ready[i].id, 'failed', (err as Error).message);
          });
        }
      };
      if (ready.length > 0) {
        spawnWithStagger().catch(() => {});
      }
    }

    // Cancel tasks whose dependencies failed
    this.cancelDependents(managed);
    this.checkJobCompletion(managed);
  }

  private cancelDependents(managed: ManagedOrchJob) {
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
  }

  private checkJobCompletion(managed: ManagedOrchJob) {
    const { tasks } = managed.job;
    const allDone = tasks.every((t) =>
      t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );
    if (!allDone) return;

    // Sum costs
    managed.job.totalCostUsd = tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

    const allCompleted = tasks.every((t) => t.status === 'completed');
    const allFailed = tasks.every((t) => t.status === 'failed' || t.status === 'cancelled');

    if (allCompleted) {
      // Transition to merge phase instead of directly completing
      this.runMergePhase(managed).catch((err) => {
        logger.error(`[orch] Merge phase failed for job ${managed.job.id}:`, err);
        this.updateJobStatus(managed, 'partial_failure');
      });
    } else if (allFailed) {
      this.updateJobStatus(managed, 'failed');
    } else {
      this.updateJobStatus(managed, 'partial_failure');
    }
  }

  // ─── Merge Phase ───

  private async runMergePhase(managed: ManagedOrchJob) {
    const { job } = managed;
    this.updateJobStatus(managed, 'merging');
    this.emit(managed, { type: 'orch_merge_start', jobId: job.id });

    const integrationBranch = `orch/${job.id.slice(5)}/integration`;

    try {
      // Create integration branch from base
      const worktree = await worktreeManager.create({
        repoPath: job.repoPath,
        branchName: integrationBranch,
        baseBranch: job.baseBranch,
      });

      job.mergeWorktreeId = worktree.id;

      // Merge tasks in priority order
      const completedTasks = job.tasks
        .filter(t => t.status === 'completed')
        .sort((a, b) => a.priority - b.priority);

      let allMerged = true;
      job.mergeResults = [];

      for (const task of completedTasks) {
        const result = await mergeNoCommit(worktree.path, task.branchName);

        if (result.success) {
          task.mergeStatus = 'merged';
          const mergeResult = { taskId: task.id, status: 'merged' as const };
          job.mergeResults.push(mergeResult);
          this.emit(managed, { type: 'orch_merge_task', jobId: job.id, taskId: task.id, status: 'merged' });
          logger.info(`[orch] Merged task ${task.id} (${task.branchName})`);
        } else {
          allMerged = false;
          const conflictFiles = result.conflicts?.join(', ') || 'unknown files';
          task.mergeStatus = 'conflict';
          task.mergeError = `Merge conflict in: ${conflictFiles}`;
          const mergeResult = { taskId: task.id, status: 'conflict' as const, error: task.mergeError };
          job.mergeResults.push(mergeResult);

          this.emit(managed, {
            type: 'orch_merge_task',
            jobId: job.id,
            taskId: task.id,
            status: 'conflict',
            error: task.mergeError,
          });

          // Abort merge and stop — subsequent merges would be on dirty state
          await abortMerge(worktree.path);
          logger.warn(`[orch] Merge conflict for task ${task.id}: ${conflictFiles}`);
          break;
        }
      }

      this.emit(managed, { type: 'orch_merge_complete', jobId: job.id, allMerged });

      if (allMerged) {
        this.updateJobStatus(managed, 'completed');
        logger.info(`[orch] All tasks merged successfully for job ${job.id}`);
      } else {
        this.updateJobStatus(managed, 'partial_failure');
        logger.warn(`[orch] Merge incomplete for job ${job.id} — conflicts detected`);
      }
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      logger.error(`[orch] Merge phase error for job ${job.id}:`, err);
      this.updateJobStatus(managed, 'partial_failure');
    }

    this.persistNow();
  }

  async startMerge(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    // Allow re-merge from partial_failure or completed states
    const completedTasks = managed.job.tasks.filter(t => t.status === 'completed');
    if (completedTasks.length === 0) {
      throw new Error('No completed tasks to merge');
    }

    // Clean up previous merge worktree if exists
    if (managed.job.mergeWorktreeId) {
      try {
        await worktreeManager.remove(managed.job.mergeWorktreeId, true);
      } catch { /* best effort */ }
      managed.job.mergeWorktreeId = null;
    }

    // Reset merge status on all tasks
    for (const task of managed.job.tasks) {
      task.mergeStatus = null;
      task.mergeError = null;
    }
    managed.job.mergeResults = [];

    await this.runMergePhase(managed);
  }

  async resolveConflict(jobId: string, taskId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    const task = managed.job.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.mergeStatus !== 'conflict') {
      throw new Error(`Task ${taskId} has no merge conflict`);
    }

    const mergeWtId = managed.job.mergeWorktreeId;
    if (!mergeWtId) throw new Error('No merge worktree found — re-run merge first');

    const worktree = worktreeManager.getWorktree(mergeWtId);
    if (!worktree) throw new Error('Merge worktree not found');

    // Spawn a merge-resolution agent in the integration worktree
    const mergeSessionId = `merge_${jobId}_${taskId}`;
    const session = await sessionManager.createSession({
      id: mergeSessionId,
      branch: worktree.branch,
      cwd: worktree.path,
      repoPath: managed.job.repoPath,
      window: managed.window,
      permissionMode: 'acceptEdits',
    });

    const conflictPrompt = `You are resolving a merge conflict. The branch "${task.branchName}" failed to merge cleanly into the integration branch.

Conflict details: ${task.mergeError}

Please:
1. Run \`git merge --no-ff ${task.branchName}\` to start the merge
2. Examine the conflict markers in the affected files
3. Resolve each conflict by choosing the correct changes (or combining them)
4. Stage the resolved files with \`git add\`
5. Complete the merge with \`git commit\`

Focus on making a correct merge that preserves all intended changes from both sides.`;

    sessionManager.onComplete(mergeSessionId, () => {
      // After merge agent finishes, update the task's merge status
      task.mergeStatus = 'merged';
      task.mergeError = null;
      const existingResult = managed.job.mergeResults.find(r => r.taskId === taskId);
      if (existingResult) {
        existingResult.status = 'merged';
        delete existingResult.error;
      }
      this.emit(managed, { type: 'orch_merge_task', jobId, taskId, status: 'merged' });

      // Check if all conflicts are now resolved
      const allResolved = managed.job.tasks
        .filter(t => t.status === 'completed')
        .every(t => t.mergeStatus === 'merged');

      if (allResolved) {
        this.emit(managed, { type: 'orch_merge_complete', jobId, allMerged: true });
        this.updateJobStatus(managed, 'completed');
      }

      this.persistNow();
    });

    sessionManager.sendMessage(mergeSessionId, conflictPrompt);

    this.emit(managed, {
      type: 'orch_task_session',
      jobId,
      taskId,
      sessionId: mergeSessionId,
      branch: worktree.branch,
      repoPath: managed.job.repoPath,
      parentSessionId: managed.job.planSessionId!,
    });
  }

  // ─── Cancel / Retry / Remove ───

  async cancelJob(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    this.clearAllTimers(managed.job);

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
    task.startedAt = null;
    task.durationMs = null;
    task.mergeStatus = null;
    task.mergeError = null;

    if (managed.job.status !== 'running') {
      this.updateJobStatus(managed, 'running');
    }

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

  async removeJob(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    if (managed.job.status === 'running' || managed.job.status === 'spawning' || managed.job.status === 'merging') {
      await this.cancelJob(jobId);
    }

    // Clean up merge worktree
    if (managed.job.mergeWorktreeId) {
      try { await worktreeManager.remove(managed.job.mergeWorktreeId, true); } catch { /* best effort */ }
      managed.job.mergeWorktreeId = null;
    }

    if (managed.job.planSessionId) {
      try {
        await sessionManager.destroySession(managed.job.planSessionId);
      } catch { /* best effort */ }
    }

    for (const task of managed.job.tasks) {
      if (task.sessionId) {
        try {
          await sessionManager.destroySession(task.sessionId);
          await worktreeManager.remove(task.sessionId, true);
        } catch { /* best effort */ }
      }
    }

    this.jobs.delete(jobId);
    this.persist();
    logger.info(`[orch] Removed job ${jobId}`);
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
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.doPersist();
    }, 500);
  }

  /** Flush persistence immediately — use for critical transitions */
  private persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.doPersist();
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
        // Backcompat: add new fields if missing
        if (!('planSessionId' in job)) (job as any).planSessionId = null;
        if (!('overlapWarnings' in job)) (job as any).overlapWarnings = [];
        if (!('mergeResults' in job)) (job as any).mergeResults = [];
        if (!('defaultTimeoutMs' in job)) (job as any).defaultTimeoutMs = DEFAULT_TIMEOUT_MS;
        if (!('circuitBreakerThreshold' in job)) (job as any).circuitBreakerThreshold = null;
        if (!('mergeWorktreeId' in job)) (job as any).mergeWorktreeId = null;

        // Backcompat: add new task fields
        for (const task of job.tasks) {
          if (!('startedAt' in task)) (task as any).startedAt = null;
          if (!('durationMs' in task)) (task as any).durationMs = null;
          if (!('timeoutMs' in task)) (task as any).timeoutMs = null;
          if (!('mergeStatus' in task)) (task as any).mergeStatus = null;
          if (!('mergeError' in task)) (task as any).mergeError = null;
        }

        // Mark planning/merging jobs as failed on restart
        if (job.status === 'planning' || job.status === 'merging') {
          job.status = 'failed';
          job.completedAt = Date.now();
        }
        // Mark running tasks as failed
        for (const task of job.tasks) {
          if (task.status === 'running' || task.status === 'spawning') {
            task.status = 'failed';
            task.error = 'App restarted during execution';
            task.completedAt = Date.now();
          }
        }
        // Recalculate job status
        const allDone = job.tasks.length > 0 && job.tasks.every((t) =>
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
    // Clear all timers
    for (const timer of this.taskTimers.values()) {
      clearTimeout(timer);
    }
    this.taskTimers.clear();

    for (const [, managed] of this.jobs) {
      if (managed.job.status === 'running' || managed.job.status === 'spawning' || managed.job.status === 'merging') {
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
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.doPersist();
  }
}

export const orchestrator = new Orchestrator();
