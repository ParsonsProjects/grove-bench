<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import UserPromptBlock from './UserPromptBlock.svelte';
  import AssistantTextBlock from './AssistantTextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import SystemBlock from './SystemBlock.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import MessageSearchBar from './MessageSearchBar.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer: HTMLDivElement;
  let shouldAutoScroll = $state(true);

  let messages = $derived(messageStore.getMessages(sessionId));
  let streamingText = $derived(messageStore.getStreamingText(sessionId));

  // Message search state
  let searchOpen = $state(false);
  let matchingIds = $state<Set<string>>(new Set());
  let currentMatchId = $state<string | null>(null);

  function handleSearchMatch(matchIds: string[], currentIndex: number) {
    matchingIds = new Set(matchIds);
    currentMatchId = matchIds[currentIndex] ?? null;
    if (currentMatchId) {
      requestAnimationFrame(() => {
        const el = scrollContainer?.querySelector(`[data-msg-id="${currentMatchId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  function closeSearch() {
    searchOpen = false;
    matchingIds = new Set();
    currentMatchId = null;
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      if (searchOpen) {
        closeSearch();
      } else {
        searchOpen = true;
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleSearchKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleSearchKeydown);
  });

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

{#if searchOpen}
  <MessageSearchBar {sessionId} onclose={closeSearch} onmatchchange={handleSearchMatch} />
{/if}

<div
  class="flex-1 overflow-y-auto px-4 py-3"
  bind:this={scrollContainer}
  onscroll={handleScroll}
>
  {#each messages as msg (msg.id)}
    {@const isMatch = matchingIds.has(msg.id)}
    {@const isCurrent = currentMatchId === msg.id}
    <div
      data-msg-id={msg.id}
      class={isMatch
        ? isCurrent
          ? 'ring-1 ring-yellow-500/60 bg-yellow-500/10 rounded'
          : 'ring-1 ring-yellow-500/30 bg-yellow-500/5 rounded'
        : ''}
    >
      {#if msg.kind === 'user'}
        <UserPromptBlock text={msg.text} />

      {:else if msg.kind === 'text'}
        <AssistantTextBlock content={msg.text} />

      {:else if msg.kind === 'tool_call'}
        <ToolCallBlock
          {sessionId}
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
        <div class="py-1 border-t border-border mt-1">
          <div class="text-xs text-muted-foreground">
            {msg.isError ? 'completed with errors' : 'done'}
            {#if msg.totalCostUsd !== undefined}
              <span class="ml-2">${msg.totalCostUsd.toFixed(4)}</span>
            {/if}
            {#if msg.durationMs !== undefined}
              <span class="ml-2">{(msg.durationMs / 1000).toFixed(1)}s</span>
            {/if}
          </div>
          {#if msg.errors?.length}
            <div class="text-xs text-destructive mt-1">{msg.errors.join(', ')}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- Streaming text (live) -->
  {#if streamingText}
    <div class="py-1 text-sm text-foreground">
      <MarkdownBlock content={streamingText} />
      <span class="inline-block w-1.5 h-4 bg-muted-foreground animate-pulse ml-0.5 align-text-bottom"></span>
    </div>
  {/if}

  <div class="h-1"></div>
</div>
