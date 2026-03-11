<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

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

<div class="border-t border-border bg-card px-4 py-3">
  {#if isRunning}
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span class="w-2 h-2 bg-primary animate-pulse"></span>
        Claude is working...
      </div>
      <Button variant="secondary" size="sm" onclick={handleStop}>
        Stop
      </Button>
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
      class="flex-1 bg-secondary border border-input px-3 py-2 text-sm text-foreground
        placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
        disabled:opacity-50 disabled:cursor-not-allowed"
    ></textarea>
    <Button
      onclick={handleSubmit}
      disabled={!value.trim() || !canSend}
      size="sm"
    >
      Send
    </Button>
  </div>
</div>
