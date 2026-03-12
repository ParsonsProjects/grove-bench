import type { OrchJob, OrchEvent, OrchTaskStatus, OrchJobStatus } from '../../shared/types.js';

class OrchestrationStore {
  jobs = $state<OrchJob[]>([]);
  activeJobId = $state<string | null>(null);
  planning = $state(false);

  private unsubscribers = new Map<string, () => void>();

  get activeJob(): OrchJob | null {
    return this.jobs.find((j) => j.id === this.activeJobId) ?? null;
  }

  jobsForRepo(repoPath: string): OrchJob[] {
    return this.jobs.filter((j) => j.repoPath === repoPath);
  }

  addJob(job: OrchJob) {
    this.jobs = [...this.jobs, job];
    this.subscribe(job.id);
  }

  updateJob(jobId: string, updates: Partial<OrchJob>) {
    this.jobs = this.jobs.map((j) =>
      j.id === jobId ? { ...j, ...updates } : j
    );
  }

  updateTaskStatus(jobId: string, taskId: string, status: OrchTaskStatus, error?: string) {
    this.jobs = this.jobs.map((j) => {
      if (j.id !== jobId) return j;
      return {
        ...j,
        tasks: j.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status, ...(error !== undefined ? { error } : {}), ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { completedAt: Date.now() } : {}) }
            : t
        ),
      };
    });
  }

  removeJob(jobId: string) {
    this.unsubscribe(jobId);
    this.jobs = this.jobs.filter((j) => j.id !== jobId);
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
    }
  }

  ingestEvent(event: OrchEvent) {
    switch (event.type) {
      case 'orch_plan_complete': {
        this.updateJob(event.jobId, { tasks: event.tasks, status: 'planned' });
        break;
      }
      case 'orch_plan_error': {
        this.updateJob(event.jobId, { status: 'failed' });
        break;
      }
      case 'orch_task_status': {
        this.updateTaskStatus(event.jobId, event.taskId, event.status, event.error);
        break;
      }
      case 'orch_job_status': {
        this.updateJob(event.jobId, { status: event.status });
        break;
      }
    }
  }

  subscribe(jobId: string) {
    if (this.unsubscribers.has(jobId)) return;
    const unsub = window.groveBench.onOrchEvent(jobId, (event) => {
      this.ingestEvent(event);
    });
    this.unsubscribers.set(jobId, unsub);
  }

  unsubscribe(jobId: string) {
    const unsub = this.unsubscribers.get(jobId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(jobId);
    }
    window.groveBench.offOrchEvent(jobId);
  }

  async loadPersistedJobs() {
    try {
      const jobs = await window.groveBench.listOrchJobs();
      for (const job of jobs) {
        if (!this.jobs.find((j) => j.id === job.id)) {
          this.jobs = [...this.jobs, job];
          // Subscribe to events for any still-active jobs
          if (job.status === 'running' || job.status === 'spawning') {
            this.subscribe(job.id);
          }
        }
      }
    } catch {
      // Failed to load — non-fatal
    }
  }
}

export const orchStore = new OrchestrationStore();
