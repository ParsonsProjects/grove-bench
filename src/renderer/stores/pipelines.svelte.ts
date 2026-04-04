import type {
  PipelineDoc,
  PipelineEvent,
  PipelineTemplate,
  TaskDoc,
  CreatePipelineOpts,
  PipelineRoleId,
} from '../../shared/types.js';

class PipelineStore {
  pipelines = $state<PipelineDoc[]>([]);
  tasks = $state<Record<string, TaskDoc[]>>({});
  templates = $state<PipelineTemplate[]>([]);
  loading = $state(false);
  private unsubscribe: (() => void) | null = null;

  async init() {
    // Load templates once
    try {
      this.templates = await window.groveBench.getPipelineTemplates();
    } catch { /* templates are static, shouldn't fail */ }

    // Subscribe to pipeline events
    this.unsubscribe = window.groveBench.onPipelineEvent((event) => {
      this.handleEvent(event);
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async loadForRepo(repoPath: string) {
    this.loading = true;
    try {
      this.pipelines = await window.groveBench.listPipelines(repoPath);
    } catch {
      this.pipelines = [];
    } finally {
      this.loading = false;
    }
  }

  async create(opts: CreatePipelineOpts): Promise<PipelineDoc> {
    const pipeline = await window.groveBench.createPipeline(opts);
    this.pipelines = [pipeline, ...this.pipelines];
    return pipeline;
  }

  async approveGate(id: string, repoPath: string) {
    await window.groveBench.approvePipelineGate(id, repoPath);
  }

  async cancel(id: string, repoPath: string) {
    await window.groveBench.cancelPipeline(id, repoPath);
  }

  async retryStage(id: string, repoPath: string) {
    await window.groveBench.retryPipelineStage(id, repoPath);
  }

  async loadTasks(pipelineId: string, repoPath: string) {
    const tasks = await window.groveBench.getPipelineTasks(pipelineId, repoPath);
    this.tasks = { ...this.tasks, [pipelineId]: tasks };
  }

  // ─── Event handling ───

  private handleEvent(event: PipelineEvent) {
    if (event.type === 'pipeline_updated') {
      this.pipelines = this.pipelines.map((p) =>
        p._id === event.pipeline._id ? event.pipeline : p,
      );
      return;
    }

    // For other events, update the matching pipeline's status in-place
    if ('pipelineId' in event) {
      this.pipelines = this.pipelines.map((p) => {
        if (p._id !== event.pipelineId) return p;

        switch (event.type) {
          case 'stage_started':
            return {
              ...p,
              status: 'running' as const,
              stages: p.stages.map((s, i) =>
                i === event.stageIndex
                  ? { ...s, status: 'running' as const, sessionId: event.sessionId }
                  : s,
              ),
            };
          case 'stage_completed':
            return {
              ...p,
              stages: p.stages.map((s, i) =>
                i === event.stageIndex
                  ? { ...s, status: event.isError ? 'failed' as const : 'completed' as const }
                  : s,
              ),
            };
          case 'gate_waiting':
            return { ...p, status: 'gate-waiting' as const };
          case 'pipeline_completed':
            return { ...p, status: 'completed' as const };
          case 'pipeline_failed':
            return { ...p, status: 'failed' as const };
          case 'pipeline_cancelled':
            return { ...p, status: 'cancelled' as const };
          default:
            return p;
        }
      });
    }
  }

  // ─── Helpers ───

  getPipelineForSession(sessionId: string): PipelineDoc | null {
    return this.pipelines.find((p) =>
      p.stages.some((s) => s.sessionId === sessionId),
    ) ?? null;
  }

  isSessionInPipeline(sessionId: string): boolean {
    return this.getPipelineForSession(sessionId) !== null;
  }

  getStageForSession(sessionId: string): { pipeline: PipelineDoc; stageIndex: number; role: PipelineRoleId } | null {
    for (const p of this.pipelines) {
      const idx = p.stages.findIndex((s) => s.sessionId === sessionId);
      if (idx >= 0) {
        return { pipeline: p, stageIndex: idx, role: p.stages[idx].role };
      }
    }
    return null;
  }

  getPipelinesForRepo(repoPath: string): PipelineDoc[] {
    return this.pipelines.filter((p) => p.repoPath === repoPath);
  }
}

export const pipelineStore = new PipelineStore();
