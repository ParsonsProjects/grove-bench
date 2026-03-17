import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { OrchJob, OrchTask, OrchCreateOpts, OrchEvent, OrchJobStatus, OrchTaskStatus } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { validateTasks, detectOverlaps, decompose, DECOMPOSE_SCHEMA } from './decomposer.js';
import { git, getGitIdentity } from './git.js';
import { logger } from './logger.js';
import { isDockerAvailable, ensureSandboxImage, getSDKVersion, killAllContainers, getDockerAuthEnv } from './docker/docker-utils.js';
import * as settings from './settings.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

const SPAWN_STAGGER_MS = 2500;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

  /** Send a status message to the planning session's agent event stream (visible in the orch thread). */
  private emitPlanStatus(managed: ManagedOrchJob, message: string) {
    const { job } = managed;
    if (!job.planSessionId) return;
    sessionManager.injectEvent(job.planSessionId, { type: 'status', message });
  }

  /** Inject a markdown-formatted plan summary into the planning session thread for user review. */
  private emitPlanSummary(managed: ManagedOrchJob, tasks: OrchTask[], warnings: OrchOverlapWarning[]) {
    const { job } = managed;
    if (!job.planSessionId) return;

    const lines: string[] = [];
    lines.push(`## Plan: ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`);
    lines.push('');

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      lines.push(`### ${t.id}: ${t.description}`);
      lines.push(`- **Branch:** \`${t.branchName}\``);
      if (t.scope.length > 0) {
        lines.push(`- **Scope:** ${t.scope.map(s => `\`${s}\``).join(', ')}`);
      }
      if (t.dependsOn.length > 0) {
        lines.push(`- **Depends on:** ${t.dependsOn.join(', ')}`);
      }
      lines.push(`- **Instruction:** ${t.instruction}`);
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push('### Overlap Warnings');
      for (const w of warnings) {
        const taskADesc = tasks.find(t => t.id === w.taskA)?.description ?? w.taskA;
        const taskBDesc = tasks.find(t => t.id === w.taskB)?.description ?? w.taskB;
        lines.push(`- **${taskADesc}** \u2194 **${taskBDesc}**: ${w.files.map(f => `\`${f}\``).join(', ')}`);
      }
      lines.push('');
    }

    lines.push('*Approve & Launch from the Plan tab to start execution, or ask me to add, remove, or edit tasks.*');

    sessionManager.injectEvent(job.planSessionId, {
      type: 'assistant_text',
      text: lines.join('\n'),
      uuid: `plan_summary_${job.id}`,
    });
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

      // Guard: task may have completed via onComplete while we were waiting.
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        logger.debug(`[orch] Timeout fired for task ${task.id} but already in terminal state: ${task.status}`);
        return;
      }

      logger.warn(`[orch] Task ${task.id} timed out after ${timeoutMs}ms`);

      if (task.sessionId) {
        try {
          await sessionManager.destroySession(task.sessionId);
        } catch { /* best effort */ }
      }

      // Safety net: destroySession currently deletes the onComplete callback
      // before the for-await loop exits, so onComplete won't fire here.
      // But if that ordering ever changes, this guard prevents double state
      // transitions.
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        logger.debug(`[orch] Task ${task.id} reached terminal state during destroy, skipping timeout failure`);
        return;
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
      defaultTimeoutMs: opts.defaultTimeoutMs ?? (settings.getSettings().defaultTaskTimeoutMinutes * 60_000 || DEFAULT_TIMEOUT_MS),
      circuitBreakerThreshold: opts.circuitBreakerThreshold ?? settings.getSettings().circuitBreakerThreshold ?? null,
      destroyedSessionIds: [],
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
- Instructions should be specific: mention exact file paths, function signatures, and expected behavior

PLAN REFINEMENT:
After outputting the initial plan, the user may ask you to add, remove, or edit tasks.
When this happens, output the COMPLETE updated task array as a fenced JSON code block (same format as above).
Always include ALL tasks in the updated array, not just the changed ones.`;

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
        logger.info(`[orch] Plan session result: isError=${ev.isError}, hasStructuredOutput=${!!ev.structured_output}, hasResult=${!!ev.result}, resultLen=${ev.result?.length ?? 0}, planHandled=${planHandled}`);
        if (!ev.isError && !planHandled) {
          planHandled = true;
          this.handlePlanComplete(managed, ev, branchPrefix, baseBranch, planStart)
            .catch((err) => {
              const errMsg = (err as Error).message;
              logger.error(`[orch] handlePlanComplete failed:`, err);
              managed.job.status = 'failed';
              this.emit(managed, { type: 'orch_plan_error', jobId: managed.job.id, error: errMsg });
              this.emitPlanStatus(managed, `Plan parsing failed: ${errMsg}`);
              this.persistNow();
            });
        } else if (ev.isError && !planHandled) {
          planHandled = true;
          managed.job.planDurationMs = Date.now() - planStart;
          managed.job.status = 'failed';
          this.emit(managed, { type: 'orch_plan_error', jobId: managed.job.id, error: 'Planning agent failed' });
          this.persistNow();
        } else if (!ev.isError && planHandled && managed.job.status === 'planned') {
          // Subsequent result while still in planned state — user refined the plan via chat.
          // Try to parse updated tasks; if successful, replace the current plan.
          this.handlePlanUpdate(managed, ev, branchPrefix, baseBranch)
            .catch((err) => {
              logger.warn(`[orch] Plan update parse failed (non-fatal, keeping current plan):`, (err as Error).message);
            });
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
        const snippet = resultEvent.result?.slice(0, 300) || '(no result text)';
        logger.error(`[orch] raw is invalid: ${JSON.stringify(raw).slice(0, 200)}, result snippet: ${snippet}`);
        throw new Error(`Planning agent did not return a valid task array. The agent may have provided analysis without the required JSON output format.`);
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

      // Inject a markdown summary of the plan into the planning session thread
      this.emitPlanSummary(managed, tasks, warnings);

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
      this.emitPlanStatus(managed, `Failed to parse plan: ${errMsg}`);
    }

    this.persistNow();
  }

  /**
   * Handle a subsequent result from the planning session while the job is still
   * in 'planned' state (user refined the plan via Activity chat).
   * Attempts to parse the result as an updated task list. If successful, replaces
   * the current tasks and re-emits orch_plan_complete so the UI updates.
   */
  private async handlePlanUpdate(
    managed: ManagedOrchJob,
    resultEvent: any,
    branchPrefix: string,
    baseBranch: string,
  ) {
    const { job } = managed;
    let raw: import('./decomposer.js').RawTask[] | null = null;

    // Try structured_output first
    if (resultEvent.structured_output) {
      const so = resultEvent.structured_output;
      raw = Array.isArray(so) ? so : so.tasks;
    }

    // Fallback: extract JSON from result text
    if (!raw && resultEvent.result) {
      let jsonStr = resultEvent.result;
      const fenceMatches = [...jsonStr.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)];
      if (fenceMatches.length > 0) {
        jsonStr = fenceMatches[fenceMatches.length - 1][1];
      }
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }
      try {
        const parsed = JSON.parse(jsonStr.trim());
        raw = Array.isArray(parsed) ? parsed : parsed.tasks;
      } catch {
        // Not valid JSON — the agent responded with plain text (no plan update)
        logger.debug(`[orch] Plan update: no JSON found in result, ignoring`);
        return;
      }
    }

    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      logger.debug(`[orch] Plan update: no valid task array found, ignoring`);
      return;
    }

    const tasks = validateTasks(raw, branchPrefix);
    for (const task of tasks) {
      task.jobId = job.id;
      task.baseBranch = baseBranch;
    }

    const warnings = detectOverlaps(tasks);
    job.overlapWarnings = warnings;
    job.tasks = tasks;

    this.emit(managed, { type: 'orch_plan_complete', jobId: job.id, tasks });
    this.emitPlanSummary(managed, tasks, warnings);

    if (warnings.length > 0) {
      this.emit(managed, { type: 'orch_overlap_warning', jobId: job.id, warnings });
    }

    logger.info(`[orch] Plan updated for job ${job.id}: ${tasks.length} tasks`);
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

    // Resolve the user's git identity from the host repo for use in containers/worktrees
    const gitIdentity = await getGitIdentity(job.repoPath);

    // Check Docker availability and auth compatibility
    this.emitPlanStatus(managed, 'Preparing subtask environment...');
    let dockerAvailable = false;
    let dockerAuthEnv: { key: string; value: string } | null = null;
    let sdkVersion = getSDKVersion();
    try {
      const dockerInstalled = await isDockerAvailable();

      if (dockerInstalled) {
        dockerAuthEnv = getDockerAuthEnv();

        if (dockerAuthEnv) {
          this.emitPlanStatus(managed, 'Building Docker sandbox image...');
          const isDev = !!process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
          await ensureSandboxImage(sdkVersion, isDev);
          dockerAvailable = true;
          logger.info(`[orch] Docker available with ${dockerAuthEnv.key}, subtasks will run in containers`);
        } else {
          logger.info(`[orch] Docker available but no container-compatible auth — falling back to in-process`);
          this.emitPlanStatus(managed, 'No container auth available — running in-process');
        }
      } else {
        logger.info(`[orch] Docker not available, subtasks will run in-process`);
      }
    } catch (err) {
      logger.warn(`[orch] Docker setup failed, falling back to in-process:`, err);
      dockerAvailable = false;
    }

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
      const taskLabel = task.isMergeTask ? 'merge task' : `task ${task.id}`;
      this.emitPlanStatus(managed, `Spawning ${taskLabel}: ${task.description.slice(0, 60)}`);

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
          permissionMode: 'acceptEdits',
          appendSystemPrompt: `IMPORTANT: You are running as an automated subtask agent with a time limit. Follow these rules:

GIT COMMITS (CRITICAL):
- You MUST commit all your changes before finishing. This is essential — uncommitted work will be lost.
- After completing your work, run: git add -A && git commit -m "feat: <brief description of what you did>"
- If you make multiple logical changes, you may use multiple commits.
- VERIFY your commit landed: run \`git log --oneline -1\` to confirm your commit is the HEAD.
- Do NOT push — the orchestrator handles integration.

BASH COMMANDS:
- Always prefix potentially slow commands with \`timeout 30\` (e.g. \`timeout 30 npx tsc --noEmit\`)
- Never run interactive commands or commands that wait for user input
- If a command times out, do not retry it — move on or try a faster alternative
- Avoid full project builds, linters, or test suites unless specifically instructed
- Keep bash commands focused and fast`,
          sandbox: {
            enabled: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
            filesystem: {
              allowWrite: [worktree.path],
            },
          },
          extraEnv: {
            CI: 'true',
            npm_config_yes: 'true',
            GIT_AUTHOR_NAME: gitIdentity.name,
            GIT_AUTHOR_EMAIL: gitIdentity.email,
            GIT_COMMITTER_NAME: gitIdentity.name,
            GIT_COMMITTER_EMAIL: gitIdentity.email,
          },
          useDocker: dockerAvailable,
          sdkVersion,
          dockerAuthEnv: dockerAuthEnv ?? undefined,
        });

        task.sessionId = session.id;
        task.startedAt = Date.now();
        this.updateTaskStatus(managed, task.id, 'running');
        this.emitPlanStatus(managed, `Task ${task.id} is now running`);

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

        // Track progress events for UI feedback (tool usage indicators)
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

        // Use onComplete for definitive completion detection.
        // After sending the single instruction we close the input stream,
        // which causes the SDK's for-await loop to exit naturally and
        // fire this callback — no race conditions with timeouts.
        sessionManager.onComplete(session.id, async (result) => {
          logger.info(`[orch] Task ${task.id} completed: isError=${result.isError}`);

          // Safety net: auto-commit any uncommitted changes the agent left behind.
          // Without this, the branch stays at the base commit and the merge task
          // has nothing to integrate.
          if (!result.isError && !task.isMergeTask) {
            await this.autoCommitWorktree(task);
          }

          this.handleTaskComplete(managed, task, result);
          sessionManager.destroySession(session.id).catch(() => {});
        });

        const sent = sessionManager.sendMessage(session.id, task.instruction);
        if (sent) {
          sessionManager.closeInputStream(session.id);
        } else {
          throw new Error('Failed to enqueue task instruction');
        }
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
    logger.info(`[orch] spawnTasks: ${ready.length} ready, ${job.tasks.length} total, statuses: ${job.tasks.map(t => `${t.id}=${t.status}`).join(', ')}`);
    this.emitPlanStatus(managed, `${ready.length} task(s) ready to spawn`);

    if (ready.length === 0) {
      // Check if any tasks are already running (deps will resolve naturally)
      const running = job.tasks.filter(t => t.status === 'running' || t.status === 'spawning');
      if (running.length > 0) {
        logger.info(`[orch] No new tasks ready but ${running.length} still running — waiting for deps`);
        // spawnReady/spawnTask closures are saved below; handleTaskComplete will call spawnReady later
      } else {
        // Deadlock: nothing running, nothing ready
        const pending = job.tasks.filter(t => t.status === 'pending');
        for (const t of pending) {
          const unmetDeps = t.dependsOn.filter(depId => {
            const dep = job.tasks.find(d => d.id === depId);
            return dep?.status !== 'completed';
          });
          if (unmetDeps.length > 0) {
            logger.warn(`[orch] Task ${t.id} blocked by unmet deps: ${unmetDeps.join(', ')}`);
          }
        }
        this.emitPlanStatus(managed, 'No tasks ready to spawn — check dependencies');
        this.updateJobStatus(managed, 'failed');
        return;
      }
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

  /**
   * Safety net: if a task agent finished without committing its changes,
   * auto-commit them so the merge task has something to integrate.
   */
  private async autoCommitWorktree(task: OrchTask) {
    if (!task.sessionId) return;
    const wt = worktreeManager.getWorktree(task.sessionId);
    if (!wt) return;

    try {
      // Guard: verify the worktree is on the expected task branch, not main.
      // Git worktrees guarantee branch isolation, but we check defensively.
      const currentBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], wt.path)).trim();
      if (currentBranch !== task.branchName) {
        logger.error(`[orch] Task ${task.id}: worktree on branch '${currentBranch}' but expected '${task.branchName}' — skipping auto-commit to avoid committing to wrong branch`);
        return;
      }

      // Check for uncommitted changes (staged + unstaged + untracked)
      const status = (await git(['status', '--porcelain'], wt.path)).trim();
      if (!status) {
        logger.debug(`[orch] Task ${task.id}: worktree clean, no auto-commit needed`);
        return;
      }

      logger.warn(`[orch] Task ${task.id}: agent left uncommitted changes on '${currentBranch}', auto-committing`);
      await git(['add', '-A'], wt.path);
      await git(['commit', '-m', `feat: ${task.description} (auto-committed by orchestrator)`], wt.path);

      // Verify the commit landed on the right branch
      const head = (await git(['rev-parse', '--short', 'HEAD'], wt.path)).trim();
      logger.info(`[orch] Task ${task.id}: auto-committed as ${head} on branch '${currentBranch}'`);
    } catch (err) {
      logger.error(`[orch] Task ${task.id}: auto-commit failed:`, err);
    }
  }

  private handleTaskComplete(
    managed: ManagedOrchJob,
    task: OrchTask,
    result: { sessionId: string; isError: boolean; totalCostUsd?: number; durationMs?: number },
  ) {
    // Clear timeout timer
    this.clearTaskTimer(task.id);

    // Guard: if the task already reached a terminal state (e.g. timed out),
    // don't process the completion callback again.
    if (task.status === 'failed' || task.status === 'completed' || task.status === 'cancelled') {
      logger.debug(`[orch] Ignoring completion for task ${task.id} — already in terminal state: ${task.status}`);
      return;
    }

    if (result.isError) {
      this.updateTaskStatus(managed, task.id, 'failed', 'Agent encountered an error');
      this.emitPlanStatus(managed, `Task ${task.id} failed`);
    } else {
      task.costUsd = result.totalCostUsd ?? null;
      this.updateTaskStatus(managed, task.id, 'completed');
      const remaining = managed.job.tasks.filter((t) => !t.isMergeTask && t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled').length;
      this.emitPlanStatus(managed, `Task ${task.id} completed${remaining > 0 ? ` (${remaining} remaining)` : ''}`);
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

    // If all non-merge tasks completed, auto-create and spawn a merge task
    const hasMergeTask = tasks.some((t) => t.isMergeTask);
    const nonMergeTasks = tasks.filter((t) => !t.isMergeTask);
    const allNonMergeCompleted = nonMergeTasks.every((t) => t.status === 'completed');

    if (!hasMergeTask && allNonMergeCompleted && nonMergeTasks.length > 0) {
      // All work tasks completed — spawn a merge task
      this.createAndSpawnMergeTask(managed).catch((err) => {
        logger.error(`[orch] Failed to create merge task for job ${managed.job.id}:`, err);
        this.updateJobStatus(managed, 'partial_failure');
      });
      return;
    }

    if (allCompleted) {
      this.emitPlanStatus(managed, 'All tasks completed successfully');
      this.updateJobStatus(managed, 'completed');
    } else if (allFailed) {
      this.emitPlanStatus(managed, 'All tasks failed');
      this.updateJobStatus(managed, 'failed');
    } else {
      const completed = tasks.filter((t) => t.status === 'completed').length;
      const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length;
      this.emitPlanStatus(managed, `Job finished: ${completed} completed, ${failed} failed`);
      this.updateJobStatus(managed, 'partial_failure');
    }
  }

  // ─── Merge (as a regular subtask) ───

  private async createAndSpawnMergeTask(managed: ManagedOrchJob) {
    const { job } = managed;
    const jobIdShort = job.id.slice(5);
    const integrationBranch = `orch/${jobIdShort}/integration`;

    // Build the merge instruction with the list of branches to merge
    const completedTasks = job.tasks
      .filter((t) => t.status === 'completed' && !t.isMergeTask)
      .sort((a, b) => a.priority - b.priority);

    const branchList = completedTasks
      .map((t, i) => `${i + 1}. \`${t.branchName}\` — ${t.description}`)
      .join('\n');

    const mergeInstruction = `You are the integration agent. Your job is to merge all completed task branches into this integration branch (based on \`${job.baseBranch}\`), then review the combined result for correctness.

## Phase 1: Merge

Merge the following branches IN ORDER using \`git merge --no-ff <branch>\` for each:
${branchList}

For each branch:
1. Run \`git merge --no-ff <branch>\`
2. If the merge succeeds cleanly, move to the next branch
3. If there are merge conflicts:
   a. Examine the conflict markers in the affected files
   b. Resolve each conflict by choosing the correct changes or combining them intelligently
   c. Stage the resolved files with \`git add <file>\`
   d. Complete the merge with \`git commit -m "Merge <branch>"\`

IMPORTANT: Merge ALL branches, not just the first one. Do not stop after the first merge.

## Phase 2: Review

After all branches are merged, review the combined changes:

1. Run \`git diff ${job.baseBranch}...HEAD --stat\` to see all changed files
2. Review the actual diffs of key files for:
   - Duplicate imports or declarations introduced by separate tasks
   - Inconsistent naming or patterns across task boundaries
   - Missing or broken cross-references (e.g. task A added a function, task B should call it)
   - Type errors or interface mismatches between changes from different tasks
3. Run a build/type check (e.g. \`timeout 60 npx tsc --noEmit\` for TypeScript) to catch compile errors
4. Fix any issues found — commit fixes as a separate "integration fixes" commit

If everything looks clean, confirm with a brief summary of what was merged and any fixes applied.`;

    const mergeTask: OrchTask = {
      id: `merge_${jobIdShort}`,
      jobId: job.id,
      description: 'Merge all task branches into integration branch',
      branchName: integrationBranch,
      baseBranch: job.baseBranch,
      scope: [],
      priority: 999, // last
      parallelizable: false,
      dependsOn: [],
      sessionId: null,
      status: 'pending',
      instruction: mergeInstruction,
      createdAt: Date.now(),
      completedAt: null,
      error: null,
      costUsd: null,
      startedAt: null,
      durationMs: null,
      timeoutMs: null,
      mergeStatus: null,
      mergeError: null,
      progressSummary: null,
      isMergeTask: true,
    };

    job.tasks.push(mergeTask);
    this.emit(managed, { type: 'orch_plan_complete', jobId: job.id, tasks: job.tasks });
    this.emit(managed, { type: 'orch_merge_start', jobId: job.id });
    this.emitPlanStatus(managed, 'All tasks completed — spawning merge task to integrate branches');
    logger.info(`[orch] Created merge task for job ${job.id}`);

    // Spawn using the same mechanism as other tasks
    if (managed.spawnTask) {
      await managed.spawnTask(mergeTask);
    } else {
      // spawnTask not set (shouldn't happen), fall back to full spawnTasks
      await this.spawnTasks(managed);
    }

    this.persist();
  }

  async startMerge(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    // Find existing merge task
    const mergeTask = managed.job.tasks.find((t) => t.isMergeTask);
    if (mergeTask) {
      // Retry the merge task
      await this.retryTask(jobId, mergeTask.id);
    } else {
      // Create a new merge task
      await this.createAndSpawnMergeTask(managed);
    }
  }

  async resolveConflict(jobId: string, _taskId: string): Promise<void> {
    // Conflicts are resolved by retrying the merge task
    await this.startMerge(jobId);
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

  /** Reset a single task to pending state, cleaning up its session and worktree. */
  private async resetTask(managed: ManagedOrchJob, task: OrchTask): Promise<void> {
    logger.info(`[orch] resetTask called: taskId=${task.id}, status=${task.status}`);
    if (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'completed') {
      logger.info(`[orch] resetTask: skipping — status ${task.status} not resettable`);
      return;
    }

    logger.info(`[orch] Resetting task ${task.id} (current status: ${task.status}, sessionId: ${task.sessionId})`);

    if (task.sessionId) {
      try {
        await sessionManager.destroySession(task.sessionId);
        await worktreeManager.remove(task.sessionId, true);
      } catch { /* best effort */ }
      task.sessionId = null;
    }

    task.status = 'pending';
    task.error = null;
    task.completedAt = null;
    task.costUsd = null;
    task.startedAt = null;
    task.durationMs = null;
    task.mergeStatus = null;
    task.mergeError = null;
    task.progressSummary = null;
    this.updateTaskStatus(managed, task.id, 'pending');
  }

  async retryTask(jobId: string, taskId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    const task = managed.job.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    logger.info(`[orch] retryTask called: jobId=${jobId}, taskId=${taskId}, taskStatus=${task.status}, jobStatus=${managed.job.status}`);

    // Also remove a stale merge task if we're retrying a work task —
    // the merge task will be auto-created again after all work tasks complete.
    if (!task.isMergeTask) {
      const mergeTask = managed.job.tasks.find((t) => t.isMergeTask);
      if (mergeTask) {
        await this.resetTask(managed, mergeTask);
        // Remove the merge task entirely — it will be recreated
        managed.job.tasks = managed.job.tasks.filter((t) => !t.isMergeTask);
      }
    }

    this.emitPlanStatus(managed, `Retrying ${task.isMergeTask ? 'merge task' : `task ${task.id}`}...`);
    await this.resetTask(managed, task);

    if (managed.job.status !== 'running') {
      this.updateJobStatus(managed, 'running');
    }

    this.spawnTasks(managed).catch((err) => {
      logger.error(`[orch] Retry spawnTasks failed for job ${jobId}:`, err);
      this.emitPlanStatus(managed, `Retry failed: ${(err as Error).message}`);
      this.updateJobStatus(managed, 'failed');
    });
  }

  async retryAllFailed(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    const failedTasks = managed.job.tasks.filter(
      (t) => (t.status === 'failed' || t.status === 'cancelled') && !t.isMergeTask
    );
    if (failedTasks.length === 0) return;

    // Remove merge task — it will be auto-recreated after all work tasks complete
    const mergeTask = managed.job.tasks.find((t) => t.isMergeTask);
    if (mergeTask) {
      await this.resetTask(managed, mergeTask);
      managed.job.tasks = managed.job.tasks.filter((t) => !t.isMergeTask);
    }

    this.emitPlanStatus(managed, `Retrying ${failedTasks.length} failed task(s)...`);

    // Reset all failed tasks first
    for (const task of failedTasks) {
      await this.resetTask(managed, task);
    }

    logger.info(`[orch] After reset, task statuses: ${managed.job.tasks.map(t => `${t.id}=${t.status} deps=[${t.dependsOn.join(',')}]`).join(', ')}`);

    if (managed.job.status !== 'running') {
      this.updateJobStatus(managed, 'running');
    }

    // Single spawnTasks call handles all pending tasks
    this.spawnTasks(managed).catch((err) => {
      logger.error(`[orch] Retry all spawnTasks failed for job ${jobId}:`, err);
      this.emitPlanStatus(managed, `Retry failed: ${(err as Error).message}`);
      this.updateJobStatus(managed, 'failed');
    });
  }

  /** Mark a subtask session as individually destroyed so removeJob can still clean up its branch. */
  markSessionDestroyed(sessionId: string): void {
    for (const managed of this.jobs.values()) {
      const task = managed.job.tasks.find((t) => t.sessionId === sessionId);
      if (task) {
        if (!managed.job.destroyedSessionIds) managed.job.destroyedSessionIds = [];
        if (!managed.job.destroyedSessionIds.includes(sessionId)) {
          managed.job.destroyedSessionIds.push(sessionId);
          this.persist();
        }
        return;
      }
    }
  }

  async removeJob(jobId: string): Promise<void> {
    const managed = this.jobs.get(jobId);
    if (!managed) throw new Error(`Job ${jobId} not found`);

    if (managed.job.status === 'running' || managed.job.status === 'spawning' || managed.job.status === 'merging') {
      await this.cancelJob(jobId);
    }

    if (managed.job.planSessionId) {
      try {
        await sessionManager.destroySession(managed.job.planSessionId);
      } catch { /* best effort */ }
    }

    const destroyed = new Set(managed.job.destroyedSessionIds ?? []);

    for (const task of managed.job.tasks) {
      if (!task.sessionId) continue;

      if (destroyed.has(task.sessionId)) {
        // Worktree already removed — just clean up the branch directly
        try {
          await git(['branch', '-D', task.branchName], managed.job.repoPath);
        } catch {
          logger.warn(`[orch] Failed to delete branch ${task.branchName} for already-destroyed session ${task.sessionId}`);
        }
      } else {
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

  getJobByPlanSession(planSessionId: string): OrchJob | undefined {
    for (const managed of this.jobs.values()) {
      if (managed.job.planSessionId === planSessionId) return managed.job;
    }
    return undefined;
  }

  /** Save the Claude SDK session ID on the orch job for plan session resumption. */
  savePlanClaudeSessionId(planSessionId: string, claudeSessionId: string): void {
    for (const managed of this.jobs.values()) {
      if (managed.job.planSessionId === planSessionId) {
        (managed.job as any).planClaudeSessionId = claudeSessionId;
        this.persist();
        return;
      }
    }
  }

  /** Get the saved Claude SDK session ID for a plan session. */
  getPlanClaudeSessionId(planSessionId: string): string | undefined {
    for (const managed of this.jobs.values()) {
      if (managed.job.planSessionId === planSessionId) {
        return (managed.job as any).planClaudeSessionId;
      }
    }
    return undefined;
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
        if (!('destroyedSessionIds' in job)) (job as any).destroyedSessionIds = [];
        if (!('mergeWorktreeId' in job)) (job as any).mergeWorktreeId = null;

        // Backcompat: add new task fields
        for (const task of job.tasks) {
          if (!('startedAt' in task)) (task as any).startedAt = null;
          if (!('durationMs' in task)) (task as any).durationMs = null;
          if (!('timeoutMs' in task)) (task as any).timeoutMs = null;
          if (!('mergeStatus' in task)) (task as any).mergeStatus = null;
          if (!('mergeError' in task)) (task as any).mergeError = null;
          if (!('progressSummary' in task)) (task as any).progressSummary = null;
        }

        // Mark planning/merging jobs as failed on restart
        if (job.status === 'planning' || job.status === 'merging') {
          job.status = 'failed';
          job.completedAt = Date.now();
        }
        // Mark non-terminal tasks as failed — in-memory spawn closures are lost on restart.
        // Skip jobs that were never launched (still in 'planned' state) — their
        // pending tasks should stay pending so the user can still approve them.
        if (job.status !== 'planned') {
          for (const task of job.tasks) {
            if (task.status === 'running' || task.status === 'spawning' || task.status === 'pending') {
              task.status = 'failed';
              task.error = 'App restarted during execution';
              task.completedAt = Date.now();
            }
          }
        }
        // Recalculate job status
        if (job.status === 'running' || job.status === 'spawning') {
          const allCompleted = job.tasks.length > 0 && job.tasks.every((t) => t.status === 'completed');
          const allFailed = job.tasks.length > 0 && job.tasks.every((t) => t.status === 'failed' || t.status === 'cancelled');
          job.status = allCompleted ? 'completed' : allFailed ? 'failed' : 'partial_failure';
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
    // Kill all Docker containers for subtasks
    await killAllContainers('grove-subtask-').catch(() => {});

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
