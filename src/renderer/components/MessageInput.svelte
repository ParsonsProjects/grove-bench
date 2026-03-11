<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';

  let { sessionId, disabled = false }: { sessionId: string; disabled?: boolean } = $props();

  let value = $state('');
  let textarea: HTMLTextAreaElement;

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let isReady = $derived(messageStore.getIsReady(sessionId));
  let canSend = $derived(!isRunning && !disabled);

  function handleSubmit() {
    const text = value.trim();
    if (!text || !canSend) return;

    messageStore.addUserMessage(sessionId, text);
    window.groveBench.sendMessage(sessionId, text);
    value = '';

    // Reset textarea height
    if (textarea) {
      textarea.style.height = 'auto';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }
  }

  function handleStop() {
    window.groveBench.stopSession(sessionId);
  }
</script>

<div class="border-t border-neutral-800 bg-neutral-900 px-4 py-3">
  {#if isRunning}
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2 text-xs text-neutral-400">
        <span class="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
        Claude is working...
      </div>
      <button
        onclick={handleStop}
        class="px-2 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300 transition-colors"
      >
        Stop
      </button>
    </div>
  {/if}

  <div class="flex gap-2">
    <textarea
      bind:this={textarea}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeydown}
      disabled={disabled}
      placeholder={isRunning ? 'Waiting for Claude...' : 'Send a message... (Enter to send, Shift+Enter for newline)'}
      rows="1"
      class="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200
        placeholder:text-neutral-500 resize-none focus:outline-none focus:border-blue-500
        disabled:opacity-50 disabled:cursor-not-allowed"
    ></textarea>
    <button
      onclick={handleSubmit}
      disabled={!value.trim() || !canSend}
      class="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500
        rounded-lg text-sm transition-colors shrink-0"
    >
      Send
    </button>
  </div>
</div>
