<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import UserPromptBlock from './UserPromptBlock.svelte';
  import AssistantTextBlock from './AssistantTextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';
  import QuestionBlock from './QuestionBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import SystemBlock from './SystemBlock.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import MessageSearchBar from './MessageSearchBar.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer: HTMLDivElement;
  let shouldAutoScroll = $state(true);

  let allMessages = $derived(messageStore.getMessages(sessionId));
  let streamingText = $derived(messageStore.getStreamingText(sessionId));
  let streamingThinking = $derived(messageStore.getStreamingThinking(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

  // Detail toggle — hide tool calls & thinking when off (defaults to summary mode)
  let showDetails = $derived(messageStore.getShowDetails(sessionId));
  const summaryVisibleTools = new Set(['Edit', 'Write', 'Bash']);
  let messages = $derived(
    showDetails
      ? allMessages.filter((m) => !(m.kind === 'tool_call' && m.awaitingPermission))
      : allMessages.filter((m) => {
          if (m.kind === 'thinking') return false;
          if (m.kind === 'tool_call') return summaryVisibleTools.has(m.toolName) && !m.awaitingPermission;
          return true;
        })
  );
  let hiddenCount = $derived(allMessages.length - messages.length);
  let summaryMode = $derived(!showDetails);

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

  // Re-enable auto-scroll when the user sends a message
  let prevMsgCount = $state(0);
  $effect(() => {
    const len = messages.length;
    if (len > prevMsgCount) {
      const last = messages[len - 1];
      if (last?.kind === 'user') {
        shouldAutoScroll = true;
      }
    }
    prevMsgCount = len;
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

  function scrollToBottom() {
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      shouldAutoScroll = true;
    }
  }
</script>

{#if searchOpen}
  <MessageSearchBar {sessionId} onclose={closeSearch} onmatchchange={handleSearchMatch} />
{/if}

<div class="flex-1 relative overflow-hidden">
<!-- Detail toggle -->
<button
  onclick={() => messageStore.setShowDetails(sessionId, !showDetails)}
  class="absolute top-2 right-3 z-30 flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border transition-colors
    {showDetails
      ? 'bg-card/80 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
      : 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20'}"
  title={showDetails ? 'Hide tool calls & thinking' : 'Show tool calls & thinking'}
>
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
    {#if showDetails}
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
    {:else}
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>
    {/if}
  </svg>
  {showDetails ? 'Detailed' : 'Summary'}{#if hiddenCount > 0} ({hiddenCount} hidden){/if}
</button>
<div
  class="pixel-bg h-full overflow-y-auto px-4 py-3 relative"
  bind:this={scrollContainer}
  onscroll={handleScroll}
>
  {#each Array(20) as _, i}
    <span
      class="blue-pixel absolute"
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
          ? 'ring-1 ring-yellow-500/60 bg-yellow-500/10'
          : 'ring-1 ring-yellow-500/30 bg-yellow-500/5'
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
          {summaryMode}
        />

      {:else if msg.kind === 'permission'}
        <PermissionBlock
          {sessionId}
          requestId={msg.requestId}
          toolName={msg.toolName}
          toolInput={msg.toolInput}
          resolved={msg.resolved}
          decision={msg.decision}
          decisionReason={msg.decisionReason}
          suggestions={msg.suggestions}
          isPlanExecution={msg.isPlanExecution}
        />

      {:else if msg.kind === 'question'}
        <QuestionBlock
          {sessionId}
          requestId={msg.requestId}
          questions={msg.questions}
          resolved={msg.resolved}
          response={msg.response}
          selectedLabels={msg.selectedLabels}
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

  <!-- Streaming thinking (live) -->
  {#if streamingThinking}
    {@const lastLine = streamingThinking.trimEnd().split('\n').at(-1)?.trim() || 'thinking...'}
    <div class="py-1 flex items-center gap-2 text-xs text-muted-foreground italic truncate">
      <span class="inline-block w-1.5 h-3 bg-purple-400 animate-pulse shrink-0"></span>
      <span class="truncate">{lastLine}</span>
    </div>
  {/if}

  <!-- Streaming text (live) -->
  {#if streamingText}
    <div class="py-1 text-sm text-foreground">
      <MarkdownBlock content={streamingText} />
      <span class="inline-block w-1.5 h-4 bg-muted-foreground animate-pulse ml-0.5 align-text-bottom"></span>
    </div>
  {:else if isRunning && !streamingThinking}
    <div class="py-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span class="inline-block w-2.5 h-2.5 bg-primary animate-fidget"></span>
      {#if activity.activity === 'thinking'}
        <span class="text-purple-400">Thinking...</span>
      {:else if activity.activity === 'tool_starting'}
        <span class="text-yellow-400">
          Running {activity.toolName ?? 'tool'}{#if activity.toolSummary}&nbsp;<span class="text-muted-foreground">{activity.toolSummary}</span>{/if}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0}&nbsp;({Math.round(activity.elapsedSeconds)}s){/if}
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

{#if !shouldAutoScroll}
  <button
    onclick={scrollToBottom}
    class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-2 py-1 text-xs bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors shadow-md"
    title="Scroll to bottom"
  >
    &darr; Bottom
  </button>
{/if}
</div>
