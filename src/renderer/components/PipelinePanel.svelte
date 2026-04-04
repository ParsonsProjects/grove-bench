<script lang="ts">
  import { onMount } from 'svelte';
  import { pipelineStore } from '../stores/pipelines.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { PipelineDoc, PipelineStageStatus, TaskDoc } from '../../shared/types.js';

  let { pipelineId, repoPath }: { pipelineId: string; repoPath: string } = $props();

  let pipeline = $derived(pipelineStore.pipelines.find((p) => p._id === pipelineId));
  let tasks = $derived(pipelineStore.tasks[pipelineId] ?? []);

  onMount(() => {
    pipelineStore.loadTasks(pipelineId, repoPath);
  });

  function statusBadge(status: PipelineStageStatus): { text: string; color: string } {
    switch (status) {
      case 'completed': return { text: 'Completed', color: 'bg-green-500/10 text-green-500' };
      case 'running': return { text: 'Running', color: 'bg-blue-500/10 text-blue-500' };
      case 'failed': return { text: 'Failed', color: 'bg-red-500/10 text-red-500' };
      case 'skipped': return { text: 'Skipped', color: 'bg-muted text-muted-foreground' };
      default: return { text: 'Pending', color: 'bg-muted text-muted-foreground/50' };
    }
  }

  function formatDuration(startedAt: string | null, completedAt: string | null): string {
    if (!startedAt) return '-';
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const ms = end - start;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60_000)}m`;
  }

  function focusSession(sessionId: string | null) {
    if (sessionId) {
      store.setActiveSession(sessionId);
    }
  }
</script>

{#if pipeline}
  <div class="flex-1 overflow-auto p-4 space-y-6">
    <!-- Header -->
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">Pipeline: {pipeline.branch}</h2>
      <p class="text-sm text-muted-foreground">{pipeline.context}</p>
      <div class="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Template: {pipeline.templateId}</span>
        <span>Cost: ${pipeline.totalCost.toFixed(2)}</span>
        <span>Created: {new Date(pipeline.createdAt).toLocaleString()}</span>
      </div>
    </div>

    <!-- Stage Timeline -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium">Stages</h3>
      <div class="space-y-1">
        {#each pipeline.stages as stage, i}
          {@const badge = statusBadge(stage.status)}
          <div
            class="flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors {stage.sessionId ? 'cursor-pointer' : ''}"
            onclick={() => focusSession(stage.sessionId)}
            role={stage.sessionId ? 'button' : undefined}
            tabindex={stage.sessionId ? 0 : undefined}
          >
            <span class="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
            <span class="capitalize font-medium w-20">{stage.role}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {badge.color}">{badge.text}</span>
            {#if stage.gate}
              <span class="text-[10px] text-yellow-500" title="Gate — requires approval">⏸ Gate</span>
            {/if}
            <span class="flex-1" />
            <span class="text-xs text-muted-foreground">{formatDuration(stage.startedAt, stage.completedAt)}</span>
            {#if stage.cost > 0}
              <span class="text-xs text-muted-foreground">${stage.cost.toFixed(2)}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Tasks -->
    {#if tasks.length > 0}
      <div class="space-y-2">
        <h3 class="text-sm font-medium">Tasks</h3>
        <div class="space-y-1">
          {#each tasks as task}
            <div class="px-3 py-2 rounded-md border border-border space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm">{task.title}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">{task.status}</span>
                <span class="capitalize text-xs text-muted-foreground">{task.assignedRole}</span>
              </div>
              {#if task.body}
                <p class="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{task.body}</p>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="flex gap-2">
      {#if pipeline.status === 'gate-waiting'}
        <Button onclick={() => pipelineStore.approveGate(pipeline!._id, repoPath)}>
          Approve & Continue
        </Button>
      {/if}
      {#if pipeline.status === 'failed'}
        <Button variant="secondary" onclick={() => pipelineStore.retryStage(pipeline!._id, repoPath)}>
          Retry Failed Stage
        </Button>
      {/if}
      {#if pipeline.status === 'running' || pipeline.status === 'gate-waiting'}
        <Button variant="destructive" onclick={() => pipelineStore.cancel(pipeline!._id, repoPath)}>
          Cancel Pipeline
        </Button>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex-1 flex items-center justify-center text-muted-foreground">
    Pipeline not found
  </div>
{/if}
