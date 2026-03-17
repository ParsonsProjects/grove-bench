import type { OrchJob, OrchEvent, OrchTaskStatus, OrchJobStatus, OrchOverlapWarning } from '../../shared/types.js';
import { store } from './sessions.svelte.js';
import { messageStore } from './messages.svelte.js';

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
            ? { ...t, status, ...(error !== undefined ? { error } : {}), ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { completedAt: Date.now(), progressSummary: null } : {}) }
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
      case 'orch_task_session': {
        if (!store.sessions.find((s) => s.id === event.sessionId)) {
          store.addSession({
            id: event.sessionId,
            branch: event.branch,
            repoPath: event.repoPath,
            status: 'running',
            parentSessionId: event.parentSessionId,
          }, false);
          // Subtask agents run in acceptEdits mode
          messageStore.setModeLocal(event.sessionId, 'acceptEdits');
        }
        break;
      }
      case 'orch_overlap_warning': {
        this.updateJob(event.jobId, { overlapWarnings: event.warnings });
        break;
      }
      case 'orch_merge_start': {
        this.updateJob(event.jobId, { status: 'merging' });
        break;
      }
      case 'orch_merge_task': {
        // Update task's merge status
        this.jobs = this.jobs.map((j) => {
          if (j.id !== event.jobId) return j;
          return {
            ...j,
            tasks: j.tasks.map((t) =>
              t.id === event.taskId
                ? { ...t, mergeStatus: event.status, mergeError: event.error ?? null }
                : t
            ),
            mergeResults: [...j.mergeResults, { taskId: event.taskId, status: event.status, error: event.error }],
          };
        });
        break;
      }
      case 'orch_merge_complete': {
        // Job status will be updated by the orch_job_status event
        break;
      }
      case 'orch_task_progress': {
        this.jobs = this.jobs.map((j) => {
          if (j.id !== event.jobId) return j;
          return {
            ...j,
            tasks: j.tasks.map((t) =>
              t.id === event.taskId ? { ...t, progressSummary: event.summary } : t
            ),
          };
        });
        break;
      }
      case 'orch_task_timeout': {
        this.updateTaskStatus(event.jobId, event.taskId, 'failed', 'Task timed out');
        break;
      }
      case 'orch_circuit_breaker': {
        // Tasks will be individually cancelled via orch_task_status events
        break;
      }
    }
  }

  /** Find the orch job associated with a session (if any). */
  jobForSession(sessionId: string): OrchJob | undefined {
    return this.jobs.find((j) => j.planSessionId === sessionId);
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
          // Subscribe to events for any non-completed job (may be retried)
          if (job.status !== 'completed') {
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
