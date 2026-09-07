<script lang="ts">
  import { onMount } from 'svelte';
  import Fuse from 'fuse.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
  import { highlightSegments } from '../lib/search-highlight.js';
  import type { CrossSessionSearchHit } from '../../shared/types.js';

  let { onclose }: { onclose: (selectedId?: string) => void } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;

  interface SessionEntry {
    id: string;
    label: string;
    branch: string;
    repoName: string;
    repoPath: string;
    status: string;
    firstPrompt: string;
    isRunning: boolean;
    hasPending: boolean;
  }

  onMount(() => {
    inputEl?.focus();
    // Previews give stopped sessions (no loaded messages) a searchable first prompt.
    sessionPreviewStore.ensure(store.sessions.map((s) => s.id));
  });

  let entries = $derived.by((): SessionEntry[] => {
    return store.sessions.map((s) => {
      const msgs = messageStore.getMessages(s.id);
      const firstUser = msgs.find((m) => m.kind === 'user');
      const firstPrompt =
        (firstUser && 'text' in firstUser ? firstUser.text.slice(0, 120) : '') ||
        sessionPreviewStore.get(s.id)?.firstPrompt ||
        '';
      return {
        id: s.id,
        label: s.displayName || s.branch,
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
        { name: 'label', weight: 0.4 },
        { name: 'branch', weight: 0.2 },
        { name: 'repoName', weight: 0.2 },
        { name: 'firstPrompt', weight: 0.2 },
      ],
      threshold: 0.4,
    })
  );

  let sessionResults = $derived.by(() => {
    if (!query.trim()) return entries;
    return fuse.search(query, { limit: 20 }).map((r) => r.item);
  });

  // ─── Cross-session content search (main-process, over full event histories) ───
  let contentHits = $state<CrossSessionSearchHit[]>([]);
  let contentLoading = $state(false);
  let reqToken = 0;

  $effect(() => {
    const q = query.trim();
    const ids = store.sessions.map((s) => s.id);
    if (q.length < 2 || ids.length === 0) {
      contentHits = [];
      contentLoading = false;
      return;
    }
    contentLoading = true;
    const token = ++reqToken;
    const timer = setTimeout(async () => {
      try {
        const hits = await window.groveBench.searchAllEventHistory(ids, q, 3);
        if (token !== reqToken) return; // superseded by a newer query
        contentHits = hits.slice(0, 30);
        selectedIndex = 0;
      } finally {
        if (token === reqToken) contentLoading = false;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  /** Flat selection list: sessions first, then conversation hits. */
  let totalResults = $derived(sessionResults.length + contentHits.length);

  $effect(() => {
    const _r = sessionResults;
    selectedIndex = 0;
  });

  function sessionLabelFor(sessionId: string): { repoName: string; label: string } {
    const s = store.sessions.find((x) => x.id === sessionId);
    if (!s) return { repoName: '?', label: sessionId };
    return { repoName: store.repoDisplayName(s.repoPath), label: s.displayName || s.branch };
  }

  function selectSession(entry: SessionEntry) {
    store.activeSessionId = entry.id;
    store.clearNeedsAttention(entry.id);
    onclose(entry.id);
  }

  function selectHit(hit: CrossSessionSearchHit) {
    store.activeSessionId = hit.sessionId;
    store.clearNeedsAttention(hit.sessionId);
    // Reuse the cross-session jump path (same one bookmarks use): the active
    // pane pages in to the hit's event index and scrolls to the message. For a
    // stopped session this waits for auto-resume + history replay.
    messageStore.requestJump(hit.sessionId, { eventIndex: hit.eventIndex, uuid: null, bookmarkId: '' });
    onclose(hit.sessionId);
  }

  function selectAt(index: number) {
    if (index < sessionResults.length) {
      selectSession(sessionResults[index]);
    } else {
      const hit = contentHits[index - sessionResults.length];
      if (hit) selectHit(hit);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, totalResults - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (totalResults > 0) selectAt(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[15vh]"
  onmousedown={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="w-full max-w-lg h-fit bg-popover border border-border shadow-2xl flex flex-col">
    <div class="px-3 py-2 border-b border-border">
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Search sessions and conversations..."
        class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>

    <div class="max-h-96 overflow-y-auto overflow-x-hidden">
      {#if totalResults === 0 && !contentLoading}
        <div class="px-3 py-4 text-xs text-muted-foreground text-center">No matches found</div>
      {:else}
        {#if sessionResults.length > 0}
          <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">Sessions</div>
          {#each sessionResults as entry, i}
            {@const isActive = store.activeSessionId === entry.id}
            <button
              class="w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 transition-colors
                {i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-popover-foreground/80 hover:bg-accent/50'}"
              onmousedown={(e) => { e.preventDefault(); selectSession(entry); }}
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
                <span class="text-muted-foreground shrink-0">{entry.repoName}</span>
                <span class="text-muted-foreground/40 shrink-0">/</span>
                <span class="font-medium truncate min-w-0">{entry.label}</span>
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

        {#if query.trim().length >= 2 && (contentHits.length > 0 || contentLoading)}
          <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/50 border-t border-border/50 flex items-center gap-2">
            In conversations
            {#if contentLoading}
              <span class="normal-case tracking-normal text-muted-foreground/40">searching…</span>
            {/if}
          </div>
          {#each contentHits as hit, j (hit.sessionId + ':' + hit.eventIndex)}
            {@const i = sessionResults.length + j}
            {@const src = sessionLabelFor(hit.sessionId)}
            <button
              class="w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 transition-colors
                {i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-popover-foreground/80 hover:bg-accent/50'}"
              onmousedown={(e) => { e.preventDefault(); selectHit(hit); }}
              onmouseenter={() => selectedIndex = i}
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-[10px] uppercase font-semibold shrink-0 {KIND_COLORS[hit.kind] ?? 'text-muted-foreground'}">{hit.kind}</span>
                <span class="text-muted-foreground shrink-0">{src.repoName}</span>
                <span class="text-muted-foreground/40 shrink-0">/</span>
                <span class="font-medium truncate min-w-0">{src.label}</span>
              </div>
              <span class="text-muted-foreground truncate min-w-0 max-w-full pl-3.5">
                {#each highlightSegments(hit.snippet, query) as seg}
                  {#if seg.match}<mark class="bg-yellow-500/30 text-foreground rounded-sm">{seg.text}</mark>{:else}{seg.text}{/if}
                {/each}
              </span>
            </button>
          {/each}
        {/if}
      {/if}
    </div>

    <div class="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/40 flex gap-3">
      <span>↑↓ navigate</span>
      <span>↵ open</span>
      <span>esc close</span>
    </div>
  </div>
</div>
