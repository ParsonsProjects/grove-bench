<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let queue = $derived(messageStore.getQueue(sessionId));
  let paused = $derived(messageStore.isQueuePaused(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  function firstLine(text: string): string {
    const line = text.split('\n')[0].trim();
    return line || text.trim();
  }
</script>

{#if queue.length > 0}
  <div class="px-4 pt-2" data-testid="message-queue">
    <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
      <span>
        {queue.length} queued
        {#if paused}
          <span class="text-yellow-500/90">· paused</span>
        {:else if isRunning}
          · sends when the agent is free
        {/if}
      </span>
      <span class="flex-1"></span>
      {#if paused}
        <button
          onclick={() => messageStore.resumeQueue(sessionId)}
          class="text-primary hover:underline"
          title="Resume sending queued messages"
        >Resume</button>
      {/if}
      <button
        onclick={() => messageStore.clearQueue(sessionId)}
        class="hover:text-foreground"
        title="Remove all queued messages"
      >Clear all</button>
    </div>
    <ul class="flex flex-col gap-1 max-h-32 overflow-y-auto">
      {#each queue as item, i (item.id)}
        <li class="flex items-center gap-2 text-xs border border-border/70 bg-card/60 px-2 py-1 group">
          <span class="text-muted-foreground shrink-0 font-mono">{i + 1}.</span>
          <span class="truncate flex-1 {item.isCommand ? 'font-mono text-primary' : 'text-foreground/90'}" title={item.displayText}>
            {firstLine(item.displayText)}
          </span>
          {#if item.images?.length}
            <span class="text-muted-foreground shrink-0">{item.images.length} image{item.images.length === 1 ? '' : 's'}</span>
          {/if}
          <button
            onclick={() => messageStore.editQueuedMessage(sessionId, item.id)}
            class="text-muted-foreground hover:text-foreground shrink-0"
            title="Move back to the input for editing"
          >Edit</button>
          <button
            onclick={() => messageStore.removeQueuedMessage(sessionId, item.id)}
            class="text-muted-foreground hover:text-destructive shrink-0 px-1"
            title="Remove from queue"
            aria-label="Remove queued message"
          >&times;</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
