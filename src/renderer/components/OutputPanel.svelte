<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import UserPromptBlock from './UserPromptBlock.svelte';
  import AssistantTextBlock from './AssistantTextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import SystemBlock from './SystemBlock.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer: HTMLDivElement;
  let shouldAutoScroll = $state(true);

  let messages = $derived(messageStore.getMessages(sessionId));
  let streamingText = $derived(messageStore.getStreamingText(sessionId));

  $effect(() => {
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
      <UserPromptBlock text={msg.text} />

    {:else if msg.kind === 'text'}
      <AssistantTextBlock content={msg.text} />

    {:else if msg.kind === 'tool_call'}
      <ToolCallBlock
        toolName={msg.toolName}
        toolInput={msg.toolInput}
        result={msg.result}
        isError={msg.isError}
        pending={msg.pending}
      />

    {:else if msg.kind === 'permission'}
      <PermissionBlock
        {sessionId}
        requestId={msg.requestId}
        toolName={msg.toolName}
        toolInput={msg.toolInput}
        resolved={msg.resolved}
        decision={msg.decision}
      />

    {:else if msg.kind === 'thinking'}
      <ThinkingBlock thinking={msg.thinking} />

    {:else if msg.kind === 'system'}
      <SystemBlock text={msg.text} />

    {:else if msg.kind === 'error'}
      <SystemBlock text={msg.text} variant="error" />

    {:else if msg.kind === 'result'}
      <div class="py-1 border-t border-neutral-800 mt-1">
        <div class="text-xs text-neutral-500">
          {msg.isError ? 'completed with errors' : 'done'}
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
    <div class="py-1 text-sm text-neutral-200">
      <MarkdownBlock content={streamingText} />
      <span class="inline-block w-1.5 h-4 bg-neutral-400 animate-pulse ml-0.5 align-text-bottom"></span>
    </div>
  {/if}

  <div class="h-1"></div>
</div>
