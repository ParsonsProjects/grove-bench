import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineManager } from './pipeline.js';
import type { PipelineEvent } from '../shared/types.js';
import type { PipelineDeps } from './pipeline.js';
import type { SessionCompletionResult } from './agent-session.js';

// Mock the MCP server creation
vi.mock('./adapters/pipeline-mcp-server.js', () => ({
  createPipelineTaskMcpServer: vi.fn().mockResolvedValue({ name: 'grove-tasks' }),
  GROVE_PIPELINE_TOOL_NAMES: [
    'mcp__grove-tasks__task_list',
    'mcp__grove-tasks__task_read',
    'mcp__grove-tasks__task_update',
    'mcp__grove-tasks__task_create',
  ],
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock pipeline-db's getPipelineDb
vi.mock('./pipeline-db.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./pipeline-db.js')>();
  return {
    ...original,
    getPipelineDb: vi.fn((_repoPath: string) => original.PipelineDb.inMemory()),
  };
});

function createMockDeps(): PipelineDeps & {
  completionCallbacks: Map<string, (result: SessionCompletionResult) => void>;
} {
  const completionCallbacks = new Map<string, (result: SessionCompletionResult) => void>();

  return {
    completionCallbacks,
    worktreeManager: {
      create: vi.fn().mockResolvedValue({
        id: 'wt-test',
        path: '/test/worktree',
        branch: 'feature/test',
      }),
    },
    sessionManager: {
      createSession: vi.fn().mockImplementation(async (opts) => ({
        id: opts.id,
        branch: opts.branch,
      })),
      sendMessage: vi.fn().mockResolvedValue(true),
      onComplete: vi.fn().mockImplementation((id, callback) => {
        completionCallbacks.set(id, callback);
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createMockWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any;
}

/** Trigger a completion callback and wait for the pipeline to process it. */
async function completeStage(
  deps: ReturnType<typeof createMockDeps>,
  manager: PipelineManager,
  callIndex: number,
  result: Partial<SessionCompletionResult> = {},
) {
  const sessionId = (deps.sessionManager.createSession as any).mock.calls[callIndex][0].id;
  const cb = deps.completionCallbacks.get(sessionId)!;
  cb({ sessionId, isError: false, ...result });
  await manager._waitForPendingCompletions();
}

describe('PipelineManager', () => {
  let manager: PipelineManager;
  let deps: ReturnType<typeof createMockDeps>;
  let window: ReturnType<typeof createMockWindow>;
  let events: PipelineEvent[];

  beforeEach(() => {
    deps = createMockDeps();
    manager = new PipelineManager(deps);
    window = createMockWindow();
    events = [];
    manager.onEvent((e) => events.push(e));
  });

  async function createFullPipeline() {
    return manager.createPipeline({
      repoPath: '/test/repo',
      branchName: 'feature/test',
      templateId: 'full',
      context: 'Build a login page',
    }, window);
  }

  describe('createPipeline', () => {
    it('creates a pipeline with correct stages from template', async () => {
      const pipeline = await createFullPipeline();

      expect(pipeline._id).toBeDefined();
      expect(pipeline.status).toBe('running');
      expect(pipeline.stages).toHaveLength(4);
      expect(pipeline.stages.map((s) => s.role)).toEqual(['planner', 'engineer', 'qa', 'reviewer']);
      expect(pipeline.stages[0].gate).toBe(true);
      expect(pipeline.stages[1].gate).toBe(false);
    });

    it('creates a worktree', async () => {
      await createFullPipeline();

      expect(deps.worktreeManager.create).toHaveBeenCalledWith({
        repoPath: '/test/repo',
        branchName: 'feature/test',
        baseBranch: undefined,
      });
    });

    it('starts the first stage session with correct config', async () => {
      await createFullPipeline();

      expect(deps.sessionManager.createSession).toHaveBeenCalledTimes(1);
      const callArgs = (deps.sessionManager.createSession as any).mock.calls[0][0];
      expect(callArgs.pipelineRole).toBe('planner');
      expect(callArgs.permissionMode).toBe('plan');
      expect(callArgs.additionalMcpServers).toEqual({ 'grove-tasks': { name: 'grove-tasks' } });
    });

    it('sends initial message to the agent', async () => {
      await createFullPipeline();

      expect(deps.sessionManager.sendMessage).toHaveBeenCalledTimes(1);
      const msg = (deps.sessionManager.sendMessage as any).mock.calls[0][1] as string;
      expect(msg).toContain('task ID');
      expect(msg).toContain('PLAN.md');
    });

    it('registers a completion callback', async () => {
      await createFullPipeline();

      expect(deps.sessionManager.onComplete).toHaveBeenCalledTimes(1);
      expect(deps.completionCallbacks.size).toBe(1);
    });

    it('emits stage_started event', async () => {
      await createFullPipeline();

      const startEvents = events.filter((e) => e.type === 'stage_started');
      expect(startEvents).toHaveLength(1);
      expect(startEvents[0]).toMatchObject({
        type: 'stage_started',
        stageIndex: 0,
        role: 'planner',
      });
    });

    it('applies gate overrides from opts', async () => {
      const pipeline = await manager.createPipeline({
        repoPath: '/test/repo',
        branchName: 'feature/test',
        templateId: 'full',
        context: 'Test',
        gates: { 0: false, 3: false },
      }, window);

      expect(pipeline.stages[0].gate).toBe(false);
      expect(pipeline.stages[3].gate).toBe(false);
    });
  });

  describe('stage completion → advance', () => {
    it('waits at gate when completed stage has gate: true', async () => {
      // Full: planner(gate:true) → engineer(false) → qa(false) → reviewer(gate:true)
      await createFullPipeline();

      // Complete planner — planner.gate is true → wait before engineer
      await completeStage(deps, manager, 0, { totalCostUsd: 0.25 });

      const gateEvents = events.filter((e) => e.type === 'gate_waiting');
      expect(gateEvents).toHaveLength(1);
      expect(gateEvents[0]).toMatchObject({
        type: 'gate_waiting',
        stageIndex: 1,
        role: 'engineer',
      });

      // Should NOT have started engineer session yet
      expect(deps.sessionManager.createSession).toHaveBeenCalledTimes(1);
    });

    it('advances immediately when completed stage has gate: false', async () => {
      // implement-qa-review: engineer(false) → qa(false) → reviewer(gate:true)
      await manager.createPipeline({
        repoPath: '/test/repo',
        branchName: 'feature/test',
        templateId: 'implement-qa-review',
        context: 'Test',
      }, window);

      // Complete engineer — gate:false → auto-advance to qa
      await completeStage(deps, manager, 0, { totalCostUsd: 0.5 });

      expect(deps.sessionManager.createSession).toHaveBeenCalledTimes(2);
      const qaCall = (deps.sessionManager.createSession as any).mock.calls[1][0];
      expect(qaCall.pipelineRole).toBe('qa');
    });

    it('marks pipeline failed on stage error', async () => {
      await createFullPipeline();

      await completeStage(deps, manager, 0, { isError: true });

      const failEvents = events.filter((e) => e.type === 'pipeline_failed');
      expect(failEvents).toHaveLength(1);
      expect(failEvents[0]).toMatchObject({
        type: 'pipeline_failed',
        stageIndex: 0,
      });
    });

    it('completes pipeline after last stage succeeds', async () => {
      // implement-qa-review: engineer(false) → qa(false) → reviewer(gate:true)
      await manager.createPipeline({
        repoPath: '/test/repo',
        branchName: 'feature/test',
        templateId: 'implement-qa-review',
        context: 'Test',
      }, window);

      // Complete engineer (gate:false) → auto to qa
      await completeStage(deps, manager, 0, { totalCostUsd: 1.0 });
      // Complete qa (gate:false) → hits reviewer gate (qa.gate = false → auto advance? No!)
      // Actually qa.gate = false → auto advance to reviewer
      await completeStage(deps, manager, 1, { totalCostUsd: 0.5 });

      // Reviewer started automatically. Now complete it.
      // reviewer.gate = true, but since it's the last stage, after completion → pipeline completes
      await completeStage(deps, manager, 2, { totalCostUsd: 0.3 });

      const completeEvents = events.filter((e) => e.type === 'pipeline_completed');
      expect(completeEvents).toHaveLength(1);
    });

    it('accumulates total cost across stages', async () => {
      await manager.createPipeline({
        repoPath: '/test/repo',
        branchName: 'feature/test',
        templateId: 'implement-qa-review',
        context: 'Test',
      }, window);

      await completeStage(deps, manager, 0, { totalCostUsd: 1.0 });
      await completeStage(deps, manager, 1, { totalCostUsd: 0.5 });

      const pipeline = (await manager.listPipelines('/test/repo'))[0];
      expect(pipeline.totalCost).toBe(1.5);
    });
  });

  describe('approveGate', () => {
    it('starts next stage after gate approval', async () => {
      // Full: planner(gate:true) → engineer → qa → reviewer(gate:true)
      const pipeline = await createFullPipeline();

      // Complete planner → gate
      await completeStage(deps, manager, 0, { totalCostUsd: 0.25 });
      expect(events.some((e) => e.type === 'gate_waiting')).toBe(true);

      // Approve gate
      await manager.approveGate(pipeline._id, '/test/repo', window);

      // Should have started engineer session
      expect(deps.sessionManager.createSession).toHaveBeenCalledTimes(2);
      const engineerCall = (deps.sessionManager.createSession as any).mock.calls[1][0];
      expect(engineerCall.pipelineRole).toBe('engineer');
    });

    it('throws if pipeline is not at a gate', async () => {
      const pipeline = await createFullPipeline();

      await expect(
        manager.approveGate(pipeline._id, '/test/repo', window),
      ).rejects.toThrow('not waiting at a gate');
    });
  });

  describe('cancelPipeline', () => {
    it('stops the running session and sets status to cancelled', async () => {
      const pipeline = await createFullPipeline();

      await manager.cancelPipeline(pipeline._id, '/test/repo', window);

      const cancelEvents = events.filter((e) => e.type === 'pipeline_cancelled');
      expect(cancelEvents).toHaveLength(1);
      expect(deps.sessionManager.stopSession).toHaveBeenCalled();
    });
  });

  describe('retryStage', () => {
    it('retries a failed stage', async () => {
      const pipeline = await createFullPipeline();

      await completeStage(deps, manager, 0, { isError: true });

      await manager.retryStage(pipeline._id, '/test/repo', window);

      expect(deps.sessionManager.createSession).toHaveBeenCalledTimes(2);
      const retryCall = (deps.sessionManager.createSession as any).mock.calls[1][0];
      expect(retryCall.pipelineRole).toBe('planner');
    });

    it('throws if pipeline is not failed', async () => {
      const pipeline = await createFullPipeline();

      await expect(
        manager.retryStage(pipeline._id, '/test/repo', window),
      ).rejects.toThrow('not in failed state');
    });
  });

  describe('queries', () => {
    it('lists pipelines for a repo', async () => {
      await createFullPipeline();
      const pipelines = await manager.listPipelines('/test/repo');
      expect(pipelines).toHaveLength(1);
    });

    it('gets tasks for a pipeline', async () => {
      const pipeline = await createFullPipeline();
      const tasks = await manager.getTasksForPipeline(pipeline._id, '/test/repo');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].assignedRole).toBe('planner');
    });
  });
});
