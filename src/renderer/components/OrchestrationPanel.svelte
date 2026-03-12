<script lang="ts">
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { OrchTaskStatus } from '../../shared/types.js';

  let { jobId }: { jobId: string } = $props();

  let job = $derived(orchStore.jobs.find((j) => j.id === jobId));
  let cancelling = $state(false);
  let retrying = $state<string | null>(null);

  const statusDot: Record<OrchTaskStatus, string> = {
    pending: 'bg-neutral-500',
    spawning: 'bg-yellow-500 animate-pulse',
    running: 'bg-green-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-neutral-400',
  };

  const statusLabel: Record<OrchTaskStatus, string> = {
    pending: 'Pending',
    spawning: 'Spawning',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  function focusTask(sessionId: string | null) {
    if (!sessionId) return;
    store.activeSessionId = sessionId;
    orchStore.activeJobId = null; // switch to session view
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

  let completedCount = $derived(job?.tasks.filter((t) => t.status === 'completed').length ?? 0);
  let totalCount = $derived(job?.tasks.length ?? 0);
  let totalCost = $derived(
    job?.tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) ?? 0
  );
  let isTerminal = $derived(
    job?.status === 'completed' || job?.status === 'failed' || job?.status === 'partial_failure' || job?.status === 'cancelled'
  );
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
      <p class="text-xs text-muted-foreground truncate" title={job.goal}>{job.goal}</p>
    </div>

    <!-- Task list -->
    <div class="flex-1 overflow-auto p-4">
      <div class="flex flex-col gap-2">
        {#each job.tasks as task (task.id)}
          <div class="border border-border p-3 hover:bg-muted/30 transition-colors">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 shrink-0 {statusDot[task.status]}"></span>
                <span class="text-sm font-medium text-foreground">{task.description}</span>
              </div>
              <span class="text-xs text-muted-foreground">{statusLabel[task.status]}</span>
            </div>

            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span class="font-mono">{task.branchName}</span>
              <div class="flex items-center gap-2">
                {#if task.costUsd !== null}
                  <span>${task.costUsd.toFixed(4)}</span>
                {/if}
                {#if task.sessionId}
                  <button
                    onclick={() => focusTask(task.sessionId)}
                    class="text-primary hover:underline"
                  >
                    View session
                  </button>
                {/if}
                {#if task.status === 'failed' || task.status === 'cancelled'}
                  <Button
                    variant="secondary"
                    size="sm"
                    class="h-5 text-xs px-2"
                    onclick={() => handleRetry(task.id)}
                    disabled={retrying === task.id}
                  >
                    {retrying === task.id ? 'Retrying...' : 'Retry'}
                  </Button>
                {/if}
              </div>
            </div>

            {#if task.error}
              <div class="mt-1 text-xs text-destructive">{task.error}</div>
            {/if}
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
