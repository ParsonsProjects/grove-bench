<script lang="ts">
  import { pipelineStore } from '../stores/pipelines.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { PipelineDoc, PipelineStageStatus } from '../../shared/types.js';

  let { pipelineId, repoPath }: { pipelineId: string; repoPath: string } = $props();

  let pipeline = $derived(pipelineStore.pipelines.find((p) => p._id === pipelineId));

  function statusIcon(status: PipelineStageStatus): string {
    switch (status) {
      case 'completed': return '✓';
      case 'running': return '●';
      case 'failed': return '✗';
      case 'skipped': return '–';
      default: return '○';
    }
  }

  function statusColor(status: PipelineStageStatus): string {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'running': return 'text-blue-500 animate-pulse';
      case 'failed': return 'text-red-500';
      case 'skipped': return 'text-muted-foreground';
      default: return 'text-muted-foreground/50';
    }
  }

  function focusStageSession(sessionId: string | null) {
    if (sessionId) {
      store.setActiveSession(sessionId);
    }
  }

  async function handleApproveGate() {
    if (!pipeline) return;
    try {
      await pipelineStore.approveGate(pipeline._id, repoPath);
    } catch { /* error handled by store */ }
  }

  async function handleCancel() {
    if (!pipeline) return;
    try {
      await pipelineStore.cancel(pipeline._id, repoPath);
    } catch { /* error handled by store */ }
  }

  async function handleRetry() {
    if (!pipeline) return;
    try {
      await pipelineStore.retryStage(pipeline._id, repoPath);
    } catch { /* error handled by store */ }
  }
</script>

{#if pipeline}
  <div class="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border text-xs shrink-0">
    <!-- Stage Steps -->
    <div class="flex items-center gap-1">
      {#each pipeline.stages as stage, i}
        {#if i > 0}
          <span class="text-muted-foreground/40">→</span>
        {/if}
        <button
          class="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors capitalize {stage.sessionId ? 'cursor-pointer' : 'cursor-default'}"
          onclick={() => focusStageSession(stage.sessionId)}
          disabled={!stage.sessionId}
        >
          <span class={statusColor(stage.status)}>{statusIcon(stage.status)}</span>
          <span class:font-semibold={stage.status === 'running'}>{stage.role}</span>
        </button>
      {/each}
    </div>

    <div class="flex-1" />

    <!-- Cost -->
    {#if pipeline.totalCost > 0}
      <span class="text-muted-foreground">${pipeline.totalCost.toFixed(2)}</span>
    {/if}

    <!-- Actions -->
    {#if pipeline.status === 'gate-waiting'}
      <Button size="sm" variant="default" onclick={handleApproveGate} class="h-6 text-xs">
        Approve & Continue
      </Button>
    {/if}

    {#if pipeline.status === 'failed'}
      <Button size="sm" variant="secondary" onclick={handleRetry} class="h-6 text-xs">
        Retry
      </Button>
    {/if}

    {#if pipeline.status === 'running' || pipeline.status === 'gate-waiting'}
      <Button size="sm" variant="ghost" onclick={handleCancel} class="h-6 text-xs text-muted-foreground hover:text-destructive">
        Cancel
      </Button>
    {/if}

    <!-- Status Badge -->
    <span class="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider
      {pipeline.status === 'running' ? 'bg-blue-500/10 text-blue-500' :
       pipeline.status === 'completed' ? 'bg-green-500/10 text-green-500' :
       pipeline.status === 'failed' ? 'bg-red-500/10 text-red-500' :
       pipeline.status === 'gate-waiting' ? 'bg-yellow-500/10 text-yellow-500' :
       'bg-muted text-muted-foreground'}">
      {pipeline.status === 'gate-waiting' ? 'gate' : pipeline.status}
    </span>
  </div>
{/if}
