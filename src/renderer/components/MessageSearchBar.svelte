<script lang="ts">
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';

  let {
    sessionId,
    onclose,
    onmatchchange,
  }: {
    sessionId: string;
    onclose: () => void;
    onmatchchange: (matchIds: string[], currentIndex: number) => void;
  } = $props();

  let query = $state('');
  let matchIndex = $state(0);
  let inputEl: HTMLInputElement;

  let messages = $derived(messageStore.getMessages(sessionId));

  /** Extract searchable text from a message */
  function textOf(msg: (typeof messages)[number]): string {
    if ('text' in msg && typeof msg.text === 'string') return msg.text;
    if ('thinking' in msg && typeof msg.thinking === 'string') return msg.thinking;
    return '';
  }

  let matchIds = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => textOf(m).toLowerCase().includes(q))
      .map((m) => m.id);
  });

  // Reset match index when results change
  $effect(() => {
    const len = matchIds.length;
    if (len === 0) {
      matchIndex = 0;
    } else if (matchIndex >= len) {
      matchIndex = len - 1;
    }
  });

  // Notify parent of match changes
  $effect(() => {
    onmatchchange(matchIds, matchIndex);
  });

  function next() {
    if (matchIds.length === 0) return;
    matchIndex = (matchIndex + 1) % matchIds.length;
  }

  function prev() {
    if (matchIds.length === 0) return;
    matchIndex = (matchIndex - 1 + matchIds.length) % matchIds.length;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prev(); else next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  onMount(() => {
    inputEl?.focus();
  });
</script>

<div class="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border text-xs shrink-0">
  <input
    bind:this={inputEl}
    bind:value={query}
    onkeydown={handleKeydown}
    type="text"
    placeholder="Search messages..."
    class="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground min-w-0"
  />

  {#if query.trim()}
    <span class="text-muted-foreground whitespace-nowrap">
      {#if matchIds.length > 0}
        {matchIndex + 1} of {matchIds.length}
      {:else}
        no results
      {/if}
    </span>
  {/if}

  <button
    onclick={prev}
    disabled={matchIds.length === 0}
    class="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
    title="Previous (Shift+Enter)"
  >↑</button>

  <button
    onclick={next}
    disabled={matchIds.length === 0}
    class="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
    title="Next (Enter)"
  >↓</button>

  <button
    onclick={onclose}
    class="text-muted-foreground hover:text-foreground px-1"
    title="Close (Esc)"
  >✕</button>
</div>
