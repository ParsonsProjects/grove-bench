<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer: HTMLDivElement;
  let shouldAutoScroll = $state(true);

  // Track message count to auto-scroll on new messages
  let messages = $derived(messageStore.getMessages(sessionId));
  let streamingText = $derived(messageStore.getStreamingText(sessionId));

  $effect(() => {
    // Trigger on messages length or streaming text changes
    const _len = messages.length;
    const _st = streamingText;
    if (shouldAutoScroll && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // Auto-scroll if user is within 100px of bottom
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 100;
  }
</script>

<div
  class="flex-1 overflow-y-auto px-4 py-3"
  bind:this={scrollContainer}
  onscroll={handleScroll}
>
  {#each messages as msg (msg.id)}
    {#if msg.kind === 'user'}
      <div class="mb-3 flex justify-end">
        <div class="bg-blue-900/40 border border-blue-800/50 rounded-lg px-3 py-2 max-w-[80%]">
          <div class="text-sm text-neutral-200 whitespace-pre-wrap">{msg.text}</div>
        </div>
      </div>

    {:else if msg.kind === 'text'}
      <div class="mb-3">
        <div class="text-sm text-neutral-200">
          <MarkdownBlock content={msg.text} />
        </div>
      </div>

    {:else if msg.kind === 'tool_call'}
      <div class="mb-1">
        <ToolCallBlock
          toolName={msg.toolName}
          toolInput={msg.toolInput}
          result={msg.result}
          isError={msg.isError}
          pending={msg.pending}
        />
      </div>

    {:else if msg.kind === 'permission'}
      <div class="mb-2">
        <PermissionBlock
          {sessionId}
          requestId={msg.requestId}
          toolName={msg.toolName}
          toolInput={msg.toolInput}
          resolved={msg.resolved}
          decision={msg.decision}
        />
      </div>

    {:else if msg.kind === 'thinking'}
      <div class="mb-2">
        <details class="text-xs text-neutral-500">
          <summary class="cursor-pointer hover:text-neutral-400">Thinking...</summary>
          <div class="mt-1 pl-3 border-l border-neutral-700 text-neutral-500 italic whitespace-pre-wrap">
            {msg.thinking}
          </div>
        </details>
      </div>

    {:else if msg.kind === 'system'}
      <div class="mb-2 text-xs text-neutral-500 italic text-center">
        {msg.text}
      </div>

    {:else if msg.kind === 'error'}
      <div class="mb-2 bg-red-950/30 border border-red-800/50 rounded px-3 py-2">
        <div class="text-xs text-red-400">{msg.text}</div>
      </div>

    {:else if msg.kind === 'result'}
      <div class="mb-2 border-t border-neutral-800 pt-2 mt-2">
        <div class="text-xs text-neutral-500">
          {msg.isError ? 'Completed with errors' : 'Done'}
          {#if msg.totalCostUsd !== undefined}
            <span class="ml-2">${msg.totalCostUsd.toFixed(4)}</span>
          {/if}
          {#if msg.durationMs !== undefined}
            <span class="ml-2">{(msg.durationMs / 1000).toFixed(1)}s</span>
          {/if}
        </div>
        {#if msg.errors?.length}
          <div class="text-xs text-red-400 mt-1">{msg.errors.join(', ')}</div>
        {/if}
      </div>
    {/if}
  {/each}

  <!-- Streaming text (live) -->
  {#if streamingText}
    <div class="mb-3">
      <div class="text-sm text-neutral-200">
        <MarkdownBlock content={streamingText} />
      </div>
      <span class="inline-block w-2 h-4 bg-neutral-400 animate-pulse ml-0.5"></span>
    </div>
  {/if}

  <!-- Scroll sentinel -->
  <div class="h-1"></div>
</div>
