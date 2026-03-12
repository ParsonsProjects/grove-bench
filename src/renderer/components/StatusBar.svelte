<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let model = $derived(messageStore.getModel(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let mode = $derived(messageStore.getMode(sessionId));

  let lastResult = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === 'result') return msgs[i] as import('../stores/messages.svelte.js').ChatResultMessage;
    }
    return null;
  });

  const modeLabels: Record<string, string> = {
    default: 'Code',
    plan: 'Plan',
    acceptEdits: 'Edit',
  };

  const modeColors: Record<string, string> = {
    default: 'text-green-400 border-green-400/40',
    plan: 'text-yellow-400 border-yellow-400/40',
    acceptEdits: 'text-purple-400 border-purple-400/40',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      messageStore.cycleMode(sessionId);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="flex items-center gap-4 px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  {#if model}
    <span>{model}</span>
  {/if}

  <button
    onclick={() => messageStore.cycleMode(sessionId)}
    class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent {modeColors[mode] ?? modeColors.default}"
    title="Change mode (Alt+M)"
  >
    {modeLabels[mode] ?? mode}
  </button>

  <span class="flex items-center gap-1.5">
    {#if isRunning}
      <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
      <span class="text-primary">running</span>
    {:else}
      <span class="w-1.5 h-1.5 bg-muted-foreground/60"></span>
      <span>idle</span>
    {/if}
  </span>

  {#if lastResult?.totalCostUsd !== undefined}
    <span>${lastResult.totalCostUsd.toFixed(4)}</span>
  {/if}

  {#if lastResult?.durationMs !== undefined}
    <span>{(lastResult.durationMs / 1000).toFixed(1)}s</span>
  {/if}

  <span class="ml-auto text-muted-foreground/40 flex gap-3">
    <span>Ctrl+R find</span>
    <span>Ctrl+F search</span>
    <span>Alt+M mode</span>
  </span>
</div>
