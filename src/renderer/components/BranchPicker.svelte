<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { branchPickerRows } from '../lib/branch-picker.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import { menuItem, menuPanel } from '$lib/components/ui/menu/index.js';
  import { cn } from '$lib/utils.js';
  import CheckIcon from '@lucide/svelte/icons/check';
  import PlusIcon from '@lucide/svelte/icons/plus';

  let { sessionId, repoPath, currentBranch, direct = false, onclose }: {
    sessionId: string;
    repoPath: string;
    currentBranch: string;
    /** Runs in the project folder itself, so a switch moves that checkout. */
    direct?: boolean;
    onclose: () => void;
  } = $props();

  let branches = $state<string[]>([]);
  let loading = $state(true);
  /** Remote branches are being fetched; the local list is already shown. */
  let fetching = $state(false);
  let query = $state('');
  let highlighted = $state(0);
  let switching = $state(false);
  let error = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  let rows = $derived(branchPickerRows(branches, query, currentBranch));
  /** Selectable rows in display order: matching branches, then "Create". */
  let options = $derived([
    ...rows.matches.map((name) => ({ name, create: false })),
    ...(rows.createName ? [{ name: rows.createName, create: true }] : []),
  ]);
  /** `highlighted`, kept in range when the fetch shortens the list. */
  let active = $derived(Math.min(highlighted, options.length - 1));

  onMount(() => {
    inputEl?.focus();
    void loadBranches();
  });

  /** Local refs first so the list shows at once, then again after a fetch
   *  picks up branches pushed since. */
  async function loadBranches() {
    try {
      branches = await window.groveBench.listBranches(repoPath, { fetch: false });
    } catch { /* leave the list empty; typing a name still works */ }
    loading = false;
    fetching = true;
    try {
      branches = await window.groveBench.listBranches(repoPath);
    } catch { /* offline: keep the local list */ }
    fetching = false;
  }

  async function switchTo(name: string, create: boolean) {
    if (switching) return;
    switching = true;
    error = null;
    try {
      const busySessionIds = store.sessions.filter((s) => messageStore.getIsRunning(s.id)).map((s) => s.id);
      const result = await window.groveBench.switchBranch(sessionId, name, { create, busySessionIds });
      if (!result.success) {
        error = result.error;
        return;
      }
      // Conversations sharing the checkout moved too.
      for (const id of result.sessionIds) {
        if (!store.sessions.some((s) => s.id === id)) continue;
        store.updateBranch(id, result.branch);
        void prStore.refresh(id, true);
      }
      onclose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      switching = false;
    }
  }

  async function move(delta: number) {
    if (options.length === 0) return;
    highlighted = Math.min(Math.max(active + delta, 0), options.length - 1);
    await tick();
    listEl?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      void move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      void move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[active];
      if (opt) void switchTo(opt.name, opt.create);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
</script>

<!-- Positioned (and animated) by the parent popover wrapper. -->
<div class={cn(menuPanel(), 'w-80 py-0')}>
  <div class="p-2 border-b border-border">
    <input
      bind:this={inputEl}
      bind:value={query}
      oninput={() => { highlighted = 0; error = null; }}
      onkeydown={onKeydown}
      type="text"
      spellcheck="false"
      class="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-mono"
      placeholder="Switch to a branch, or type a new name"
    />
  </div>

  {#if direct}
    <div class="px-2 py-1.5 border-b border-border text-amber-500">
      This thread runs in your project folder. Switching changes the branch there too, for your editor and any other thread using that folder.
    </div>
  {/if}

  <!-- Above the list: the popover grows upward from the status bar, so
       anything added below the rows would slide them under the cursor. -->
  {#if error}
    <div class="px-2 py-1.5 border-b border-border text-red-400 break-words">{error}</div>
  {/if}

  <div class="max-h-64 overflow-y-auto py-1" bind:this={listEl}>
    {#if loading}
      <div class="px-2 py-3 text-muted-foreground text-center">Loading branches…</div>
    {:else}
      {#each options as opt, i (opt.create ? `+${opt.name}` : opt.name)}
        <button
          data-index={i}
          onclick={() => switchTo(opt.name, opt.create)}
          onmouseenter={() => highlighted = i}
          disabled={switching}
          class={cn(menuItem(), i === active && 'bg-accent text-accent-foreground')}
          title={opt.create
            ? 'Create this branch from the current commit and switch to it. Uncommitted changes come along.'
            : opt.name}
        >
          <span class="w-3 shrink-0 flex justify-center">
            {#if opt.create}
              <PlusIcon class="size-3" aria-hidden="true" />
            {:else if opt.name === currentBranch}
              <CheckIcon class="size-3" aria-hidden="true" />
            {/if}
          </span>
          {#if opt.create}
            <span class="truncate">Create branch <span class="font-mono text-foreground">{opt.name}</span></span>
          {:else}
            <span class="font-mono truncate">{opt.name}</span>
          {/if}
        </button>
      {:else}
        <div class="px-2 py-3 text-muted-foreground text-center">No branches match</div>
      {/each}
    {/if}
  </div>

  <div class="flex min-h-7 items-center px-2 py-1.5 border-t border-border text-micro">
    {#if switching}
      <span class="text-muted-foreground">Switching…</span>
    {:else if fetching}
      <span class="text-muted-foreground">Fetching remote branches…</span>
    {:else}
      <span class="flex flex-wrap items-center gap-1 text-muted-foreground"><Kbd variant="key">↑</Kbd><Kbd variant="key">↓</Kbd> to pick, <Kbd variant="key">Enter</Kbd> to switch, <Kbd variant="key">Esc</Kbd> to close</span>
    {/if}
  </div>
</div>
