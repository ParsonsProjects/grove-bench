<script lang="ts">
  import Fuse, { type IFuseOptions } from 'fuse.js';

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

  interface FileEntry {
    path: string;
    filename: string;
    isDir: boolean;
  }

  let files = $state<FileEntry[]>([]);
  let loading = $state(true);
  let selectedIndex = $state(0);
  let fuse: Fuse<FileEntry> | null = null;

  let cacheKey = $derived(`filepicker:${sessionId}`);
  const CACHE_TTL = 30_000;

  const fileCache = new Map<string, { files: FileEntry[]; ts: number }>();

  function toEntries(paths: string[]): FileEntry[] {
    return paths.map((p) => {
      const isDir = p.endsWith('/');
      const clean = isDir ? p.slice(0, -1) : p;
      return {
        path: p,
        filename: clean.split('/').pop() ?? clean,
        isDir,
      };
    });
  }

  const fuseOpts: IFuseOptions<FileEntry> = {
    keys: [
      { name: 'filename', weight: 2 },
      { name: 'path', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  };

  $effect(() => {
    const cached = fileCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      files = cached.files;
      fuse = new Fuse(files, fuseOpts);
      loading = false;
    } else {
      loading = true;
      window.groveBench.listFiles(sessionId).then((result) => {
        files = toEntries(result);
        fileCache.set(cacheKey, { files, ts: Date.now() });
        fuse = new Fuse(files, fuseOpts);
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
  }) as FileEntry[];

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
        onselect(filtered[selectedIndex].path);
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
    {#each filtered as entry, i}
      <button
        class="w-full text-left px-3 py-1 text-xs hover:bg-accent block
          {i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-popover-foreground/80'}"
        onmousedown={(e) => { e.preventDefault(); onselect(entry.path); }}
      >
        <span class="text-muted-foreground/60 mr-1">{entry.isDir ? '\u{1F4C1}' : '\u{1F4C4}'}</span>
        <span class="text-foreground">{entry.filename}{entry.isDir ? '/' : ''}</span>
        {#if !entry.isDir}
          <span class="text-muted-foreground ml-1.5">{entry.path.slice(0, entry.path.length - entry.filename.length)}</span>
        {/if}
      </button>
    {/each}
  {/if}
</div>
