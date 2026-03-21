<script lang="ts">
  import { onMount } from 'svelte';
  import Fuse from 'fuse.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';

  let { onclose }: { onclose: (selectedId?: string) => void } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;

  interface SessionEntry {
    id: string;
    branch: string;
    repoName: string;
    repoPath: string;
    status: string;
    firstPrompt: string;
    isRunning: boolean;
    hasPending: boolean;
  }

  let entries = $derived.by((): SessionEntry[] => {
    return store.sessions.map((s) => {
      const msgs = messageStore.getMessages(s.id);
      const firstUser = msgs.find((m) => m.kind === 'user');
      const firstPrompt = firstUser && 'text' in firstUser ? firstUser.text.slice(0, 120) : '';
      return {
        id: s.id,
        branch: s.branch,
        repoName: store.repoDisplayName(s.repoPath),
        repoPath: s.repoPath,
        status: s.status,
        firstPrompt,
        isRunning: messageStore.getIsRunning(s.id),
        hasPending: messageStore.hasPendingPermission(s.id),
      };
    });
  });

  let fuse = $derived(
    new Fuse(entries, {
      keys: [
        { name: 'branch', weight: 0.5 },
        { name: 'repoName', weight: 0.3 },
        { name: 'firstPrompt', weight: 0.2 },
      ],
      threshold: 0.4,
    })
  );

  let results = $derived.by(() => {
    if (!query.trim()) return entries;
    return fuse.search(query, { limit: 20 }).map((r) => r.item);
  });

  $effect(() => {
    const _r = results;
    selectedIndex = 0;
  });

  function select(entry: SessionEntry) {
    store.activeSessionId = entry.id;
    onclose(entry.id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) select(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  onMount(() => {
    inputEl?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[15vh]"
  onmousedown={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="w-full max-w-md h-fit bg-popover border border-border shadow-2xl flex flex-col">
    <div class="px-3 py-2 border-b border-border">
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Search sessions..."
        class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>

    <div class="max-h-72 overflow-y-auto">
      {#if results.length === 0}
        <div class="px-3 py-4 text-xs text-muted-foreground text-center">No sessions found</div>
      {:else}
        {#each results as entry, i}
          {@const isActive = store.activeSessionId === entry.id}
          <button
            class="w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 transition-colors
              {i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-popover-foreground/80 hover:bg-accent/50'}"
            onmousedown={(e) => { e.preventDefault(); select(entry); }}
            onmouseenter={() => selectedIndex = i}
          >
            <div class="flex items-center gap-2">
              {#if entry.status === 'error'}
                <span class="w-2 h-2 bg-red-500 shrink-0"></span>
              {:else if entry.status === 'starting' || entry.status === 'installing'}
                <span class="w-2 h-2 bg-yellow-500 animate-pulse shrink-0"></span>
              {:else if entry.isRunning}
                <span class="w-2 h-2 bg-primary animate-pulse shrink-0"></span>
              {:else if entry.hasPending}
                <span class="w-2 h-2 bg-amber-500 animate-pulse shrink-0"></span>
              {:else if entry.status === 'stopped'}
                <span class="w-2 h-2 bg-neutral-500 shrink-0"></span>
              {:else}
                <span class="w-2 h-2 bg-green-500 shrink-0"></span>
              {/if}
              <span class="text-muted-foreground">{entry.repoName}</span>
              <span class="text-muted-foreground/40">/</span>
              <span class="font-medium truncate">{entry.branch}</span>
              {#if isActive}
                <span class="ml-auto text-muted-foreground/40 text-[10px]">active</span>
              {/if}
            </div>
            {#if entry.firstPrompt}
              <span class="text-muted-foreground truncate pl-3.5">{entry.firstPrompt}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/40 flex gap-3">
      <span>↑↓ navigate</span>
      <span>↵ select</span>
      <span>esc close</span>
    </div>
  </div>
</div>
