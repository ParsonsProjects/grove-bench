<script lang="ts">
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { OrchTask, OrchTaskStatus } from '../../shared/types.js';

  let { jobId }: { jobId: string } = $props();

  let job = $derived(orchStore.jobs.find((j) => j.id === jobId));
  let cancelling = $state(false);
  let retrying = $state<string | null>(null);

  // Kanban columns — merge 'spawning' into 'In Progress'
  interface KanbanColumn {
    key: string;
    label: string;
    statuses: OrchTaskStatus[];
    color: string;
    headerBg: string;
    dotClass: string;
  }

  const columns: KanbanColumn[] = [
    { key: 'queued', label: 'Queued', statuses: ['pending'], color: 'border-neutral-500/40', headerBg: 'bg-neutral-500/10', dotClass: 'bg-neutral-500' },
    { key: 'active', label: 'In Progress', statuses: ['spawning', 'running'], color: 'border-blue-500/40', headerBg: 'bg-blue-500/10', dotClass: 'bg-blue-500 animate-pulse' },
    { key: 'done', label: 'Done', statuses: ['completed'], color: 'border-green-500/40', headerBg: 'bg-green-500/10', dotClass: 'bg-green-500' },
    { key: 'blocked', label: 'Failed', statuses: ['failed', 'cancelled'], color: 'border-red-500/40', headerBg: 'bg-red-500/10', dotClass: 'bg-red-500' },
  ];

  function tasksForColumn(col: KanbanColumn): OrchTask[] {
    if (!job) return [];
    return job.tasks.filter((t) => col.statuses.includes(t.status));
  }

  function focusTask(sessionId: string | null) {
    if (!sessionId) return;
    store.activeSessionId = sessionId;
    orchStore.activeJobId = null;
  }

  async function handleCancel() {
    if (!job) return;
    cancelling = true;
    try {
      await window.groveBench.cancelOrchJob(job.id);
    } catch { /* best effort */ }
    cancelling = false;
  }

  async function handleRetry(taskId: string) {
    if (!job) return;
    retrying = taskId;
    try {
      await window.groveBench.retryOrchTask(job.id, taskId);
    } catch { /* best effort */ }
    retrying = null;
  }

  function depNames(task: OrchTask): string {
    if (!job || task.dependsOn.length === 0) return '';
    return task.dependsOn
      .map((depId) => {
        const dep = job!.tasks.find((t) => t.id === depId);
        return dep ? dep.description.slice(0, 20) : depId;
      })
      .join(', ');
  }

  function elapsed(task: OrchTask): string {
    if (!task.completedAt) return '';
    const ms = task.completedAt - task.createdAt;
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  let completedCount = $derived(job?.tasks.filter((t) => t.status === 'completed').length ?? 0);
  let totalCount = $derived(job?.tasks.length ?? 0);
  let totalCost = $derived(
    job?.tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) ?? 0
  );
  let isTerminal = $derived(
    job?.status === 'completed' || job?.status === 'failed' || job?.status === 'partial_failure' || job?.status === 'cancelled'
  );

  // Progress bar percentage
  let progressPct = $derived(totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
</script>

{#if job}
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-border bg-card shrink-0">
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-sm font-medium text-foreground">Orchestration</h2>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">
            {completedCount}/{totalCount} tasks
          </span>
          {#if !isTerminal}
            <Button
              variant="destructive"
              size="sm"
              onclick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Cancel'}
            </Button>
          {/if}
        </div>
      </div>
      <p class="text-xs text-muted-foreground truncate mb-2" title={job.goal}>{job.goal}</p>
      <!-- Progress bar -->
      <div class="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full transition-all duration-500 ease-out rounded-full {job.status === 'failed' || job.status === 'partial_failure' ? 'bg-red-500' : job.status === 'completed' ? 'bg-green-500' : 'bg-primary'}"
          style="width: {progressPct}%"
        ></div>
      </div>
    </div>

    <!-- Kanban board -->
    <div class="flex-1 overflow-auto p-3">
      <div class="flex gap-3 h-full min-h-0">
        {#each columns as col (col.key)}
          {@const colTasks = tasksForColumn(col)}
          <div class="flex-1 flex flex-col min-w-[180px] max-w-[320px]">
            <!-- Column header -->
            <div class="flex items-center gap-2 px-2 py-1.5 mb-2 border-b-2 {col.color}">
              <span class="w-2 h-2 shrink-0 rounded-full {col.dotClass}"></span>
              <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{col.label}</span>
              {#if colTasks.length > 0}
                <span class="text-xs text-muted-foreground/60 ml-auto">{colTasks.length}</span>
              {/if}
            </div>

            <!-- Column body -->
            <div class="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0 pr-1">
              {#each colTasks as task (task.id)}
                <div class="border border-border bg-card p-2.5 hover:border-muted-foreground/30 transition-colors group">
                  <!-- Task title -->
                  <p class="text-sm font-medium text-foreground mb-1 leading-snug">{task.description}</p>

                  <!-- Branch -->
                  <p class="text-xs text-muted-foreground font-mono truncate mb-1.5" title={task.branchName}>
                    {task.branchName.split('/').pop()}
                  </p>

                  <!-- Dependencies -->
                  {#if task.dependsOn.length > 0}
                    <div class="flex items-center gap-1 mb-1.5 text-xs text-muted-foreground/70">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span class="truncate" title={depNames(task)}>{depNames(task)}</span>
                    </div>
                  {/if}

                  <!-- Scope badges -->
                  {#if task.scope.length > 0}
                    <div class="flex flex-wrap gap-1 mb-1.5">
                      {#each task.scope.slice(0, 2) as s}
                        <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground rounded-sm font-mono">{s.split('/').pop()}</span>
                      {/each}
                      {#if task.scope.length > 2}
                        <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground rounded-sm">+{task.scope.length - 2}</span>
                      {/if}
                    </div>
                  {/if}

                  <!-- Error message -->
                  {#if task.error}
                    <div class="text-xs text-destructive mb-1.5 line-clamp-2">{task.error}</div>
                  {/if}

                  <!-- Footer: cost, elapsed, actions -->
                  <div class="flex items-center justify-between mt-1 pt-1 border-t border-border/50">
                    <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {#if task.costUsd !== null}
                        <span>${task.costUsd.toFixed(4)}</span>
                      {/if}
                      {#if elapsed(task)}
                        <span>{elapsed(task)}</span>
                      {/if}
                      {#if task.status === 'running' || task.status === 'spawning'}
                        <span class="flex items-center gap-1">
                          <span class="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
                          {task.status === 'spawning' ? 'Starting...' : 'Active'}
                        </span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-1">
                      {#if task.sessionId}
                        <button
                          onclick={() => focusTask(task.sessionId)}
                          class="text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          View
                        </button>
                      {/if}
                      {#if task.status === 'failed' || task.status === 'cancelled'}
                        <Button
                          variant="secondary"
                          size="sm"
                          class="h-5 text-[10px] px-1.5"
                          onclick={() => handleRetry(task.id)}
                          disabled={retrying === task.id}
                        >
                          {retrying === task.id ? '...' : 'Retry'}
                        </Button>
                      {/if}
                    </div>
                  </div>
                </div>
              {:else}
                <div class="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 min-h-[60px]">
                  No tasks
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Footer summary -->
    <div class="px-4 py-2 border-t border-border bg-card shrink-0 flex items-center justify-between text-xs text-muted-foreground">
      <div class="flex items-center gap-3">
        <span>Status: <span class="text-foreground">{job.status}</span></span>
        {#if job.planDurationMs}
          <span>Plan: {(job.planDurationMs / 1000).toFixed(1)}s</span>
        {/if}
      </div>
      {#if totalCost > 0}
        <span>Total cost: ${totalCost.toFixed(4)}</span>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex items-center justify-center h-full text-muted-foreground text-sm">
    Job not found
  </div>
{/if}
