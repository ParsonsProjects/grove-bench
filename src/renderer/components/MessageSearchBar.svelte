<script lang="ts">
  import { onMount } from 'svelte';
  import type { EventSearchHit } from '../../shared/types.js';

  let {
    sessionId,
    onclose,
    onjump,
  }: {
    sessionId: string;
    onclose: () => void;
    onjump: (hit: EventSearchHit) => void;
  } = $props();

  let query = $state('');
  let hits = $state<EventSearchHit[]>([]);
  let selected = $state(0);
  let loading = $state(false);
  let inputEl: HTMLInputElement;

  // Monotonic request token so a slow earlier search can't overwrite a newer one.
  let reqToken = 0;

  // Debounced full-history search in the main process (150ms). The effect's
  // cleanup cancels an in-flight debounce when the query changes or we unmount.
  $effect(() => {
    const q = query.trim();
    if (!q) {
      hits = [];
      loading = false;
      return;
    }
    loading = true;
    const token = ++reqToken;
    const timer = setTimeout(async () => {
      try {
        const results = await window.groveBench.searchEventHistory(sessionId, q);
        if (token !== reqToken) return; // a newer query superseded this one
        hits = results;
        selected = 0;
      } finally {
        if (token === reqToken) loading = false;
      }
    }, 150);
    return () => clearTimeout(timer);
  });

  /** Split a snippet into match / non-match segments for highlighting. */
  function segments(snippet: string, q: string): { text: string; match: boolean }[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return [{ text: snippet, match: false }];
    const lower = snippet.toLowerCase();
    const out: { text: string; match: boolean }[] = [];
    let i = 0;
    while (i < snippet.length) {
      const idx = lower.indexOf(needle, i);
      if (idx < 0) { out.push({ text: snippet.slice(i), match: false }); break; }
      if (idx > i) out.push({ text: snippet.slice(i, idx), match: false });
      out.push({ text: snippet.slice(idx, idx + needle.length), match: true });
      i = idx + needle.length;
    }
    return out;
  }

  function jumpTo(index: number) {
    const hit = hits[index];
    if (hit) onjump(hit);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length) selected = (selected + 1) % hits.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) selected = (selected - 1 + hits.length) % hits.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jumpTo(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  const KIND_COLORS: Record<string, string> = {
    user: 'text-primary',
    assistant: 'text-foreground',
    thinking: 'text-purple-400',
    tool: 'text-yellow-400',
    permission: 'text-amber-500',
    result: 'text-muted-foreground',
    system: 'text-muted-foreground',
  };

  onMount(() => {
    inputEl?.focus();
  });
</script>

<div class="relative shrink-0">
  <div class="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border text-xs">
    <input
      bind:this={inputEl}
      bind:value={query}
      onkeydown={handleKeydown}
      type="text"
      placeholder="Search full history..."
      class="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground min-w-0"
    />

    {#if query.trim()}
      <span class="text-muted-foreground whitespace-nowrap">
        {#if loading}
          searching…
        {:else if hits.length > 0}
          {hits.length}{hits.length === 100 ? '+' : ''} match{hits.length === 1 ? '' : 'es'}
        {:else}
          no results
        {/if}
      </span>
    {/if}

    <button
      onclick={onclose}
      class="text-muted-foreground hover:text-foreground px-1"
      title="Close (Esc)"
    >✕</button>
  </div>

  {#if hits.length > 0}
    <div class="absolute left-0 right-0 top-full z-40 max-h-72 overflow-y-auto bg-card border-b border-x border-border shadow-lg">
      {#each hits as hit, i (hit.eventIndex)}
        <button
          type="button"
          onclick={() => jumpTo(i)}
          onmouseenter={() => (selected = i)}
          class="w-full text-left flex items-baseline gap-2 px-3 py-1.5 border-b border-border/50 last:border-b-0 transition-colors {i === selected ? 'bg-primary/10' : 'hover:bg-muted/40'}"
        >
          <span class="text-[10px] uppercase font-semibold shrink-0 w-16 {KIND_COLORS[hit.kind] ?? 'text-muted-foreground'}">{hit.kind}</span>
          <span class="text-xs text-muted-foreground truncate">
            {#each segments(hit.snippet, query) as seg}
              {#if seg.match}<mark class="bg-yellow-500/30 text-foreground rounded-sm">{seg.text}</mark>{:else}{seg.text}{/if}
            {/each}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
