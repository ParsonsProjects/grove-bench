<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import ChatInput from './ChatInput.svelte';
  import ChatMessage from './ChatMessage.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer: HTMLDivElement;
  let userScrolledUp = false;
  let cleanup: (() => void) | null = null;
  let permissionCleanup: (() => void) | null = null;

  let session = $derived(store.sessions.find((s) => s.id === sessionId));

  async function scrollToBottom() {
    await tick();
    if (scrollContainer && !userScrolledUp) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 50;
  }

  async function handleSend(message: string) {
    store.addUserMessage(sessionId, message);
    await scrollToBottom();
    try {
      await window.groveBench.sendMessage(sessionId, message);
    } catch (e: any) {
      store.setError(e.message || String(e));
    }
  }

  onMount(() => {
    cleanup = window.groveBench.onClaudeEvent(sessionId, (event) => {
      store.handleClaudeEvent(sessionId, event);
      scrollToBottom();
    });

    permissionCleanup = window.groveBench.onPermissionRequest((request) => {
      if (request.sessionId === sessionId) {
        store.addPermissionBlock(sessionId, request.requestId, request.toolName, request.input);
        scrollToBottom();
      }
    });
  });

  onDestroy(() => {
    if (cleanup) cleanup();
    if (permissionCleanup) permissionCleanup();
    window.groveBench.offClaudeEvent(sessionId);
  });
</script>

<div class="flex flex-col h-full">
  <!-- Messages area -->
  <div
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto px-4 py-4 space-y-4"
  >
    {#if session && session.messages.length === 0 && session.currentBlocks.length === 0}
      <div class="flex-1 flex items-center justify-center h-full text-neutral-600">
        <div class="text-center">
          <p class="text-lg mb-2">Send a message to start the agent</p>
          <p class="text-sm">The agent will work in its own git worktree.</p>
        </div>
      </div>
    {:else if session}
      {#each session.messages as message, i (i)}
        <ChatMessage {message} {sessionId} />
      {/each}

      <!-- Streaming blocks (current turn) -->
      {#if session.currentBlocks.length > 0}
        <ChatMessage message={{ role: 'assistant', blocks: session.currentBlocks }} {sessionId} />
      {/if}

      <!-- Busy indicator -->
      {#if session.status === 'busy' && session.currentBlocks.length === 0}
        <div class="flex items-center gap-2 text-neutral-500 text-sm">
          <span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
          Thinking...
        </div>
      {/if}
    {/if}
  </div>

  <!-- Input area -->
  <ChatInput
    disabled={session?.status === 'busy'}
    onsubmit={handleSend}
  />
</div>
