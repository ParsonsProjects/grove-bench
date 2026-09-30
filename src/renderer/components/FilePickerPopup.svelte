<script lang="ts" module>
  import Fuse, { type IFuseOptions } from 'fuse.js';
  import { toEntries, type FileEntry } from '$lib/file-picker.js';

  // Module-level so the listing and the Fuse index survive the popup closing
  // (it is unmounted on every '@'). Shown at once on the next '@' while a
  // fresh listing loads, so new files appear without waiting on a timer.
  const fileCache = new Map<string, { paths: string[]; files: FileEntry[]; fuse: Fuse<FileEntry> }>();

  const fuseOpts: IFuseOptions<FileEntry> = {
    keys: [
      { name: 'filename', weight: 2 },
      { name: 'path', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  };

  function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((p, i) => p === b[i]);
  }

  let nextId = 0;
</script>

<script lang="ts">
  import { searchFiles, initialItems, moveSelection, type PickerResults } from '$lib/file-picker.js';
  import { untrack } from 'svelte';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';

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

  const listId = `file-picker-${nextId++}`;

  // Raw: the list is replaced wholesale, never mutated, and Fuse reads every
  // entry per search — a deep proxy would add a trap per property access.
  let files = $state.raw<FileEntry[]>([]);
  let fuse = $state.raw<Fuse<FileEntry> | null>(null);
  let loading = $state(true);
  let selectedIndex = $state(0);
  let listEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    const id = sessionId;
    const cached = fileCache.get(id);
    if (cached) {
      files = cached.files;
      fuse = cached.fuse;
      loading = false;
    } else {
      loading = true;
    }
    // Changed files lead the list for a bare '@'. Untracked: refresh reads
    // store state this effect must not depend on.
    untrack(() => void gitStatusStore.refresh(id));
    let stale = false;
    window.groveBench.listFiles(id).then((paths) => {
      const current = fileCache.get(id);
      if (current && sameList(current.paths, paths)) {
        if (!stale) loading = false;
        return;
      }
      const entries = toEntries(paths);
      const index = new Fuse(entries, fuseOpts);
      fileCache.set(id, { paths, files: entries, fuse: index });
      if (stale) return;
      files = entries;
      fuse = index;
      loading = false;
    }).catch(() => {
      if (!stale) loading = false;
    });
    return () => { stale = true; };
  });

  let changedPaths = $derived(
    gitStatusStore.getStatus(sessionId).entries
      .filter((e) => e.status !== 'deleted')
      .map((e) => e.filePath),
  );

  let results = $derived.by((): PickerResults => {
    if (!query) return initialItems(files, changedPaths);
    return searchFiles(files, query, fuse);
  });

  // A different list starts at the top. Keyed on the rows, not the results
  // object, so a status refresh that changes nothing keeps the selection.
  let resultsKey = $derived(results.items.map((i) => i.entry.path).join('\n'));
  $effect(() => {
    const _k = resultsKey;
    selectedIndex = 0;
  });

  $effect(() => {
    const i = selectedIndex;
    const row = listEl?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    // Not implemented in jsdom.
    row?.scrollIntoView?.({ block: 'nearest' });
  });

  export function handleKeydown(e: KeyboardEvent): boolean {
    const count = results.items.length;
    const next = moveSelection(e.key, selectedIndex, count);
    if (next !== null) {
      e.preventDefault();
      selectedIndex = next;
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && count > 0) {
      e.preventDefault();
      onselect(results.items[selectedIndex].entry.path);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return true;
    }
    // With nothing to pick, Enter sends and Tab moves on as usual.
    return false;
  }

  function dirOf(entry: FileEntry): string {
    return entry.isDir ? '' : entry.path.slice(0, entry.path.length - entry.filename.length);
  }
</script>

<div class="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border z-50 shadow-xl">
  <div
    bind:this={listEl}
    id={listId}
    role="listbox"
    aria-label="Files"
    class="max-h-60 overflow-y-auto"
  >
    {#if loading}
      <div class="px-3 py-2 text-xs text-muted-foreground">Loading files...</div>
    {:else if results.items.length === 0}
      <div class="px-3 py-2 text-xs text-muted-foreground">{query ? 'No matches' : 'No files'}</div>
    {:else}
      {#each results.items as item, i (item.entry.path)}
        {#if item.group && item.group !== results.items[i - 1]?.group}
          <div role="presentation" class="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {item.group === 'Changed' ? 'Changed files' : 'Project'}
          </div>
        {/if}
        <div
          role="option"
          tabindex="-1"
          id="{listId}-{i}"
          data-index={i}
          aria-selected={i === selectedIndex}
          title={item.entry.path}
          class="flex items-baseline gap-1.5 min-w-0 px-3 py-1 text-xs cursor-pointer
            {i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-popover-foreground/80'}"
          onmousemove={() => { if (selectedIndex !== i) selectedIndex = i; }}
          onmousedown={(e) => { e.preventDefault(); onselect(item.entry.path); }}
        >
          <span class="shrink-0 text-muted-foreground/60">{item.entry.isDir ? '\u{1F4C1}' : '\u{1F4C4}'}</span>
          <span class="shrink-0 text-foreground">{item.entry.filename}{item.entry.isDir ? '/' : ''}</span>
          <span class="min-w-0 truncate text-muted-foreground">{dirOf(item.entry)}</span>
        </div>
      {/each}
    {/if}
  </div>
  {#if !loading && results.more > 0}
    <div class="px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
      +{results.more}{results.moreIsLowerBound ? '+' : ''} more, keep typing to narrow
    </div>
  {/if}
</div>
