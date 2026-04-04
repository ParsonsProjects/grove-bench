/**
 * Pipeline orchestration — deterministic state machine that coordinates
 * multi-stage agent sessions (Planner → Engineer → QA → Reviewer).
 */
import { BrowserWindow } from 'electron';
import type {
  CreatePipelineOpts,
  PipelineDoc,
  PipelineEvent,
  PipelineRoleId,
  PipelineStage,
  TaskDoc,
} from '../shared/types.js';
import { IPC } from '../shared/types.js';
import { PipelineDb, getPipelineDb } from './pipeline-db.js';
import { getTemplate } from './pipeline-templates.js';
import { getRoleDefinition } from './pipeline-roles.js';
import { createPipelineTaskMcpServer, GROVE_PIPELINE_TOOL_NAMES } from './adapters/pipeline-mcp-server.js';
import { logger } from './logger.js';
import type { SessionCompletionResult } from './agent-session.js';

// ─── Deps injected to avoid circular imports ───

export interface PipelineDeps {
  worktreeManager: {
    create(opts: {
      repoPath: string;
      branchName: string;
      baseBranch?: string;
      id?: string;
    }): Promise<{ id: string; path: string; branch: string }>;
  };
  sessionManager: {
    createSession(opts: {
      id: string;
      branch: string;
      cwd: string;
      repoPath: string;
      window: BrowserWindow;
      permissionMode?: 'default' | 'plan' | 'acceptEdits';
      appendSystemPrompt?: string | null;
      allowedTools?: string[] | null;
      pipelineId?: string | null;
      pipelineRole?: PipelineRoleId | null;
      additionalMcpServers?: Record<string, unknown> | null;
    }): Promise<{ id: string; branch: string }>;
    sendMessage(id: string, content: string): Promise<boolean>;
    onComplete(id: string, callback: (result: SessionCompletionResult) => void): void;
    stopSession(id: string): Promise<void>;
  };
}

// ─── Event emitter ───

type PipelineEventListener = (event: PipelineEvent) => void;

class PipelineManager {
  private deps: PipelineDeps;
  private dbs = new Map<string, PipelineDb>();
  private listeners: PipelineEventListener[] = [];
  /** Tracks in-flight completion handlers — exposed for testing. */
  private _pendingCompletions: Promise<void>[] = [];

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  // ─── Event subscription ───

  onEvent(listener: PipelineEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: PipelineEvent, window?: BrowserWindow): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC.PIPELINE_EVENT, event);
    }
  }

  // ─── DB access ───

  private getDb(repoPath: string): PipelineDb {
    let db = this.dbs.get(repoPath);
    if (!db) {
      db = getPipelineDb(repoPath);
      this.dbs.set(repoPath, db);
    }
    return db;
  }

  // ─── Lifecycle ───

  async createPipeline(opts: CreatePipelineOpts, window: BrowserWindow): Promise<PipelineDoc> {
    const template = getTemplate(opts.templateId);
    const db = this.getDb(opts.repoPath);

    // Create worktree
    const worktree = await this.deps.worktreeManager.create({
      repoPath: opts.repoPath,
      branchName: opts.branchName,
      baseBranch: opts.baseBranch,
    });

    const now = new Date().toISOString();
    const stages: PipelineStage[] = template.stages.map((ts, i) => ({
      role: ts.role,
      status: 'pending',
      sessionId: null,
      taskId: null,
      startedAt: null,
      completedAt: null,
      cost: 0,
      gate: opts.gates?.[i] ?? ts.gate,
    }));

    const pipeline = await db.createPipeline({
      repoPath: opts.repoPath,
      branch: worktree.branch,
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      templateId: opts.templateId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      currentStageIndex: 0,
      totalCost: 0,
      context: opts.context,
      stages,
    });

    logger.info(`Pipeline created: id=${pipeline._id}, template=${opts.templateId}, stages=${stages.length}`);

    // Start first stage
    await this.startStage(pipeline, db, window);

    return pipeline;
  }

  async cancelPipeline(pipelineId: string, repoPath: string, window?: BrowserWindow): Promise<void> {
    const db = this.getDb(repoPath);
    const pipeline = await db.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    // Stop the running session if any
    const runningStage = pipeline.stages.find((s) => s.status === 'running');
    if (runningStage?.sessionId) {
      try {
        await this.deps.sessionManager.stopSession(runningStage.sessionId);
      } catch { /* best effort */ }
    }

    await db.updatePipeline(pipelineId, { status: 'cancelled', updatedAt: new Date().toISOString() });
    this.emit({ type: 'pipeline_cancelled', pipelineId }, window);

    const updated = await db.getPipeline(pipelineId);
    if (updated) this.emit({ type: 'pipeline_updated', pipeline: updated }, window);
  }

  async approveGate(pipelineId: string, repoPath: string, window: BrowserWindow): Promise<void> {
    const db = this.getDb(repoPath);
    const pipeline = await db.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (pipeline.status !== 'gate-waiting') {
      throw new Error(`Pipeline is not waiting at a gate (status: ${pipeline.status})`);
    }

    // currentStageIndex already points to the gated stage — start it directly
    await db.updatePipeline(pipelineId, { status: 'running', updatedAt: new Date().toISOString() });
    const updated = await db.getPipeline(pipelineId);
    if (updated) {
      await this.startStage(updated, db, window);
    }
  }

  async retryStage(pipelineId: string, repoPath: string, window: BrowserWindow): Promise<void> {
    const db = this.getDb(repoPath);
    const pipeline = await db.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (pipeline.status !== 'failed') {
      throw new Error(`Pipeline is not in failed state (status: ${pipeline.status})`);
    }

    // Reset the failed stage
    const stageIndex = pipeline.currentStageIndex;
    await db.updatePipelineStage(pipelineId, stageIndex, {
      status: 'pending',
      sessionId: null,
      taskId: null,
      startedAt: null,
      completedAt: null,
      cost: 0,
    });
    await db.updatePipeline(pipelineId, { status: 'running', updatedAt: new Date().toISOString() });

    const updated = await db.getPipeline(pipelineId);
    if (updated) {
      this.emit({ type: 'pipeline_updated', pipeline: updated }, window);
      await this.startStage(updated, db, window);
    }
  }

  // ─── Internal state machine ───

  private async startStage(pipeline: PipelineDoc, db: PipelineDb, window: BrowserWindow): Promise<void> {
    const stageIndex = pipeline.currentStageIndex;
    const stage = pipeline.stages[stageIndex];
    if (!stage) {
      logger.error(`No stage at index ${stageIndex} for pipeline ${pipeline._id}`);
      return;
    }

    const role = getRoleDefinition(stage.role);
    const now = new Date().toISOString();

    // Create task for this stage
    const task = await db.createTask({
      pipelineId: pipeline._id,
      title: `${role.displayName}: ${pipeline.context.slice(0, 100)}`,
      body: this.buildTaskBody(pipeline, stageIndex),
      status: 'new',
      assignedRole: stage.role,
      priority: 1,
      branch: pipeline.branch,
      labels: [],
      createdAt: now,
      updatedAt: now,
    });

    // Update stage with task ID and status
    await db.updatePipelineStage(pipeline._id, stageIndex, {
      status: 'running',
      taskId: task._id,
      startedAt: now,
    });

    // Create MCP server for task tools
    const mcpServer = await createPipelineTaskMcpServer(db, pipeline._id);

    // Build the system prompt for this role
    const contextSummary = this.buildContextSummary(pipeline, stageIndex);
    const fullPrompt = [
      role.systemPrompt,
      '',
      '## Pipeline Context',
      `Task ID: ${task._id}`,
      `Pipeline: ${pipeline.context}`,
      `Branch: ${pipeline.branch}`,
      `Stage: ${stageIndex + 1} of ${pipeline.stages.length} (${role.displayName})`,
      '',
      contextSummary,
    ].filter(Boolean).join('\n');

    // Create session
    const sessionId = `pipe-${pipeline._id.slice(0, 6)}-${stageIndex}`;
    const alwaysAllowed = [...GROVE_PIPELINE_TOOL_NAMES];

    const session = await this.deps.sessionManager.createSession({
      id: sessionId,
      branch: pipeline.branch,
      cwd: pipeline.worktreePath,
      repoPath: pipeline.repoPath,
      window,
      permissionMode: role.permissionMode,
      appendSystemPrompt: fullPrompt,
      allowedTools: role.allowedTools,
      pipelineId: pipeline._id,
      pipelineRole: stage.role,
      additionalMcpServers: { 'grove-tasks': mcpServer },
    });

    // Update stage with session ID
    await db.updatePipelineStage(pipeline._id, stageIndex, {
      sessionId: session.id,
    });

    // Register completion callback
    this.deps.sessionManager.onComplete(session.id, (result) => {
      const p = this.onStageComplete(pipeline._id, pipeline.repoPath, stageIndex, result, window).catch((err) => {
        logger.error(`Failed to handle stage completion for pipeline ${pipeline._id}:`, err);
      });
      this._pendingCompletions.push(p);
      p.finally(() => {
        this._pendingCompletions = this._pendingCompletions.filter((x) => x !== p);
      });
    });

    // Send initial message to kick off the agent
    const initialMessage = this.buildInitialMessage(pipeline, stageIndex, task);
    await this.deps.sessionManager.sendMessage(session.id, initialMessage);

    this.emit({
      type: 'stage_started',
      pipelineId: pipeline._id,
      stageIndex,
      role: stage.role,
      sessionId: session.id,
    }, window);

    const updated = await db.getPipeline(pipeline._id);
    if (updated) this.emit({ type: 'pipeline_updated', pipeline: updated }, window);

    logger.info(`Pipeline ${pipeline._id} stage ${stageIndex} (${role.displayName}) started: session=${session.id}`);
  }

  private async onStageComplete(
    pipelineId: string,
    repoPath: string,
    stageIndex: number,
    result: SessionCompletionResult,
    window: BrowserWindow,
  ): Promise<void> {
    const db = this.getDb(repoPath);
    const pipeline = await db.getPipeline(pipelineId);
    if (!pipeline) return;

    const now = new Date().toISOString();
    const stage = pipeline.stages[stageIndex];

    // Update stage
    await db.updatePipelineStage(pipelineId, stageIndex, {
      status: result.isError ? 'failed' : 'completed',
      completedAt: now,
      cost: result.totalCostUsd ?? 0,
    });

    // Update pipeline total cost
    const newTotalCost = pipeline.totalCost + (result.totalCostUsd ?? 0);
    await db.updatePipeline(pipelineId, { totalCost: newTotalCost, updatedAt: now });

    this.emit({
      type: 'stage_completed',
      pipelineId,
      stageIndex,
      role: stage.role,
      isError: result.isError,
    }, window);

    logger.info(`Pipeline ${pipelineId} stage ${stageIndex} completed: isError=${result.isError}, cost=${result.totalCostUsd ?? 0}`);

    if (result.isError) {
      await db.updatePipeline(pipelineId, { status: 'failed' });
      this.emit({
        type: 'pipeline_failed',
        pipelineId,
        stageIndex,
        error: `Stage ${stageIndex} (${stage.role}) failed`,
      }, window);
    } else {
      // Refresh pipeline after updates
      const refreshed = await db.getPipeline(pipelineId);
      if (refreshed) {
        await this.advancePipeline(refreshed, db, window);
      }
    }

    const updated = await db.getPipeline(pipelineId);
    if (updated) this.emit({ type: 'pipeline_updated', pipeline: updated }, window);
  }

  private async advancePipeline(pipeline: PipelineDoc, db: PipelineDb, window: BrowserWindow): Promise<void> {
    const nextIndex = pipeline.currentStageIndex + 1;

    if (nextIndex >= pipeline.stages.length) {
      // All stages done
      await db.updatePipeline(pipeline._id, {
        status: 'completed',
        currentStageIndex: nextIndex,
        updatedAt: new Date().toISOString(),
      });
      this.emit({ type: 'pipeline_completed', pipelineId: pipeline._id }, window);
      logger.info(`Pipeline ${pipeline._id} completed`);
      return;
    }

    const completedStage = pipeline.stages[pipeline.currentStageIndex];
    const nextStage = pipeline.stages[nextIndex];

    // Gate on the completed stage means "require approval before starting the next stage"
    if (completedStage?.gate) {
      await db.updatePipeline(pipeline._id, {
        status: 'gate-waiting',
        currentStageIndex: nextIndex,
        updatedAt: new Date().toISOString(),
      });
      this.emit({
        type: 'gate_waiting',
        pipelineId: pipeline._id,
        stageIndex: nextIndex,
        role: nextStage.role,
      }, window);
      logger.info(`Pipeline ${pipeline._id} waiting at gate for stage ${nextIndex} (${nextStage.role})`);
      return;
    }

    // No gate — start next stage
    await db.updatePipeline(pipeline._id, {
      currentStageIndex: nextIndex,
      updatedAt: new Date().toISOString(),
    });
    const updated = await db.getPipeline(pipeline._id);
    if (updated) {
      await this.startStage(updated, db, window);
    }
  }

  // ─── Prompt builders ───

  private buildTaskBody(pipeline: PipelineDoc, stageIndex: number): string {
    const lines = [
      `## Requirements`,
      '',
      pipeline.context,
      '',
    ];

    // Include summaries from previous stages
    if (stageIndex > 0) {
      lines.push('## Previous Stage Notes', '');
      for (let i = 0; i < stageIndex; i++) {
        const s = pipeline.stages[i];
        lines.push(`### Stage ${i + 1}: ${s.role} (${s.status})`);
        if (s.taskId) {
          lines.push(`Task ID: ${s.taskId} — read with \`task_read\` for details.`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private buildContextSummary(pipeline: PipelineDoc, stageIndex: number): string {
    if (stageIndex === 0) return '';

    const lines = ['## Previous Stages'];
    for (let i = 0; i < stageIndex; i++) {
      const s = pipeline.stages[i];
      lines.push(`- Stage ${i + 1} (${s.role}): ${s.status}${s.taskId ? ` — task: ${s.taskId}` : ''}`);
    }
    return lines.join('\n');
  }

  private buildInitialMessage(pipeline: PipelineDoc, stageIndex: number, task: TaskDoc): string {
    const role = getRoleDefinition(pipeline.stages[stageIndex].role);

    switch (role.id) {
      case 'planner':
        return [
          `Your task ID is: ${task._id}`,
          '',
          `Please analyse the following requirements and produce a detailed implementation plan in PLAN.md:`,
          '',
          pipeline.context,
          '',
          'Start by reading CLAUDE.md, then explore the codebase. Update your task status to `in-progress` using the task_update tool, then write the plan. When done, update the task status to `implemented`.',
        ].join('\n');

      case 'engineer':
        return [
          `Your task ID is: ${task._id}`,
          '',
          'Read PLAN.md and implement the feature using TDD methodology.',
          'Update your task status to `in-progress`, then start coding.',
          'When done, update the task status to `implemented` and commit your work.',
        ].join('\n');

      case 'qa':
        return [
          `Your task ID is: ${task._id}`,
          '',
          'Run the test suite, verify the implementation matches requirements in PLAN.md.',
          'Write additional tests for edge cases.',
          'Update your task status to `in-progress`, then start testing.',
          'When done, update the task status to `qa-passed` if everything looks good, or `failed` with details.',
        ].join('\n');

      case 'reviewer':
        return [
          `Your task ID is: ${task._id}`,
          '',
          'Review all changes on this branch: run `git diff main...HEAD`.',
          'Check the previous stage notes in the task DB for context.',
          'Update your task status to `in-progress`, then start reviewing.',
          'When done, update the task status to `completed` if approved, or `failed` with specific issues.',
        ].join('\n');

      default:
        return `Your task ID is: ${task._id}\n\n${pipeline.context}`;
    }
  }

  /** Wait for all in-flight completion handlers to settle. For testing only. */
  async _waitForPendingCompletions(): Promise<void> {
    await Promise.all(this._pendingCompletions);
  }

  // ─── Queries ───

  async getPipeline(pipelineId: string, repoPath: string): Promise<PipelineDoc | null> {
    const db = this.getDb(repoPath);
    return db.getPipeline(pipelineId);
  }

  async listPipelines(repoPath: string): Promise<PipelineDoc[]> {
    const db = this.getDb(repoPath);
    return db.listPipelines();
  }

  async getTasksForPipeline(pipelineId: string, repoPath: string): Promise<TaskDoc[]> {
    const db = this.getDb(repoPath);
    return db.listTasksForPipeline(pipelineId);
  }
}

// ─── Singleton ───

let _pipelineManager: PipelineManager | null = null;

export function initPipelineManager(deps: PipelineDeps): PipelineManager {
  _pipelineManager = new PipelineManager(deps);
  return _pipelineManager;
}

export function getPipelineManager(): PipelineManager {
  if (!_pipelineManager) {
    throw new Error('PipelineManager not initialized — call initPipelineManager() first');
  }
  return _pipelineManager;
}

// Export the class for testing
export { PipelineManager };
