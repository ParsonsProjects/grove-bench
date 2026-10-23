<script lang="ts">
  import { onMount } from 'svelte';
  import HighlightedText from './HighlightedText.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { menuItem, menuPanel } from '$lib/components/ui/menu/index.js';
  import { cn } from '$lib/utils.js';
  import XIcon from '@lucide/svelte/icons/x';
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
  <div class="flex min-h-8 items-center gap-2 px-3 py-1.5 bg-card/50 border-b border-border text-xs">
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

    <Button
      variant="quiet"
      size="icon-2xs"
      onclick={onclose}
      title="Close (Esc)"
      aria-label="Close search"
    ><XIcon /></Button>
  </div>

  {#if hits.length > 0}
    <div class={cn(menuPanel(), 'absolute left-0 right-0 top-full z-40 max-h-72 overflow-y-auto border-t-0 py-0')}>
      {#each hits as hit, i (hit.eventIndex)}
        <button
          type="button"
          onclick={() => jumpTo(i)}
          onmouseenter={() => (selected = i)}
          class={cn(menuItem(), 'items-baseline px-3 py-1.5 border-b border-b-border/50 last:border-b-0', i === selected && 'bg-accent text-accent-foreground')}
        >
          <span class="text-micro uppercase font-semibold shrink-0 w-16 {KIND_COLORS[hit.kind] ?? 'text-muted-foreground'}">{hit.kind}</span>
          <span class="text-xs text-muted-foreground truncate"><HighlightedText text={hit.snippet} {query} /></span>
        </button>
      {/each}
    </div>
  {/if}
</div>
