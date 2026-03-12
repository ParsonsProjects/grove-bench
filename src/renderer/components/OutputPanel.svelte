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
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

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
  class="pixel-bg flex-1 overflow-y-auto px-4 py-3 relative"
  bind:this={scrollContainer}
  onscroll={handleScroll}
>
  {#each Array(20) as _, i}
    <span
      class="blue-pixel absolute rounded-[1px]"
      style="
        width: 4px; height: 4px;
        top: {Math.round((8 + (((i * 37 + 13) * 7) % 84)) / 100 * 800 / 6) * 6}px;
        left: {Math.round((5 + (((i * 53 + 7) * 11) % 90)) / 100 * 1400 / 6) * 6}px;
        animation-delay: {(i * 1.3) % 6}s;
      "
    ></span>
  {/each}

  {#if messages.length === 0 && !streamingText}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      <div class="text-center relative z-10">
        <p class="text-sm mb-1 opacity-60">Waiting for input...</p>
        <p class="text-xs opacity-40">Type a message below to start the conversation.</p>
      </div>
    </div>
  {/if}

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
  {:else if isRunning}
    <div class="py-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span class="inline-block w-2.5 h-2.5 bg-primary animate-pulse"></span>
      {#if activity.activity === 'thinking'}
        <span class="text-purple-400">Thinking...</span>
      {:else if activity.activity === 'tool_starting'}
        <span class="text-yellow-400">
          Running {activity.toolName ?? 'tool'}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0} ({Math.round(activity.elapsedSeconds)}s){/if}
        </span>
      {:else if activity.activity === 'generating'}
        <span class="text-primary">Writing...</span>
      {:else}
        <span>Working...</span>
      {/if}
    </div>
  {/if}

  <div class="h-1"></div>
</div>
