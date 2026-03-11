<script lang="ts">
  import Fuse from 'fuse.js';

  let {
    sessionId,
    query,
    onselect,
    onclose,
  }: {
    sessionId: string;
    query: string;
    onselect: (path: string) => void;
    onclose: () => void;
  } = $props();

  let files = $state<string[]>([]);
  let loading = $state(true);
  let selectedIndex = $state(0);
  let fuse: Fuse<string> | null = null;

  let cacheKey = `filepicker:${sessionId}`;
  const CACHE_TTL = 30_000;

  const fileCache = new Map<string, { files: string[]; ts: number }>();

  $effect(() => {
    const cached = fileCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      files = cached.files;
      fuse = new Fuse(files, { threshold: 0.4 });
      loading = false;
    } else {
      loading = true;
      window.groveBench.listFiles(sessionId).then((result) => {
        files = result;
        fileCache.set(cacheKey, { files: result, ts: Date.now() });
        fuse = new Fuse(files, { threshold: 0.4 });
        loading = false;
      }).catch(() => {
        loading = false;
      });
    }
  });

  let filtered = $derived.by(() => {
    if (!query) return files.slice(0, 20);
    if (!fuse) return [];
    return fuse.search(query, { limit: 20 }).map(r => r.item);
  });

  $effect(() => {
    const _f = filtered;
    selectedIndex = 0;
  });

  export function handleKeydown(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (filtered.length > 0) {
        onselect(filtered[selectedIndex]);
      }
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return true;
    }
    return false;
  }
</script>

<div class="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border max-h-60 overflow-y-auto z-50 shadow-xl">
  {#if loading}
    <div class="px-3 py-2 text-xs text-muted-foreground">Loading files...</div>
  {:else if filtered.length === 0}
    <div class="px-3 py-2 text-xs text-muted-foreground">No matches</div>
  {:else}
    {#each filtered as file, i}
      <button
        class="w-full text-left px-3 py-1 text-xs text-popover-foreground/80 hover:bg-accent block
          {i === selectedIndex ? 'bg-accent text-accent-foreground' : ''}"
        onmousedown={(e) => { e.preventDefault(); onselect(file); }}
      >
        {file}
      </button>
    {/each}
  {/if}
</div>
