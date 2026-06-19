<script lang="ts">
  import { untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import DiffView, { computeDiffLines, parseDiffLines } from './DiffView.svelte';
  import type { DiffLine } from './DiffView.svelte';
  import { hunkLineIndices } from '../lib/diff-highlight.js';
  import type { GitStatusEntry, FileDiffResult } from '../../shared/types.js';
  import CopyButton from './CopyButton.svelte';
  import ImageDiffView from './ImageDiffView.svelte';
  import SelectionMenu from './SelectionMenu.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { settingsStore } from '../stores/settings.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let gitStatus = $derived(gitStatusStore.getStatus(sessionId));
  let isLoading = $derived(gitStatusStore.isLoading(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  // Group entries by section
  let stagedEntries = $derived(gitStatus.entries.filter(e => e.staged));
  let unstagedEntries = $derived(gitStatus.entries.filter(e => !e.staged && e.status !== 'untracked'));
  let untrackedEntries = $derived(gitStatus.entries.filter(e => e.status === 'untracked'));

  // Edit history from tool calls (for the expandable sub-section)
  let editHistory = $derived(messageStore.getLastTurnFileChanges(sessionId));
  let editHistoryByFile = $derived(
    new Map(editHistory.map(fc => [fc.filePath, fc]))
  );

  // Per-file UI state
  let selectedFileKey = $state<string | null>(null);
  let sideBySide = $state(settingsStore.current.diffViewMode === 'side-by-side');
  let editHistoryExpanded = $state<Set<string>>(new Set());
  let revertingFiles = $state<Set<string>>(new Set());
  let fileDiffs = $state<Record<string, FileDiffResult>>({});

  // Search filter
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchFocused = $state(false);
  let dropdownIndex = $state(-1);

  // Derived: selected entry
  let selectedEntry = $derived(
    gitStatus.entries.find(e => fileKey(e) === selectedFileKey) ?? null
  );

  function matchesSearch(entry: GitStatusEntry): boolean {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return entry.filePath.toLowerCase().includes(q);
  }

  let filteredStagedEntries = $derived(stagedEntries.filter(matchesSearch));
  let filteredUnstagedEntries = $derived(unstagedEntries.filter(matchesSearch));
  let filteredUntrackedEntries = $derived(untrackedEntries.filter(matchesSearch));
  let filteredTotal = $derived(filteredStagedEntries.length + filteredUnstagedEntries.length + filteredUntrackedEntries.length);

  // Dropdown items: all matching entries in display order
  let dropdownEntries = $derived(
    searchQuery
      ? [...filteredStagedEntries, ...filteredUnstagedEntries, ...filteredUntrackedEntries]
      : []
  );
  let showDropdown = $derived(searchFocused && dropdownEntries.length > 0);

  function selectDropdownEntry(entry: GitStatusEntry) {
    const key = fileKey(entry);
    selectedFileKey = key;
    loadDiff(entry);
    searchQuery = '';
    searchFocused = false;
    searchInputEl?.blur();
    // Scroll sidebar item into view
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-file-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dropdownIndex = Math.min(dropdownIndex + 1, dropdownEntries.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dropdownIndex = Math.max(dropdownIndex - 1, 0);
    } else if (e.key === 'Enter' && dropdownIndex >= 0 && dropdownIndex < dropdownEntries.length) {
      e.preventDefault();
      selectDropdownEntry(dropdownEntries[dropdownIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      searchQuery = '';
      searchFocused = false;
      searchInputEl?.blur();
    }
  }

  // Reset dropdown index when query changes
  $effect(() => {
    searchQuery;
    dropdownIndex = 0;
  });

  // Collapsed sections
  let collapsedSections = $state<Set<string>>(new Set());

  // Flat list of visible entries (respects collapsed sections and search)
  let visibleEntries = $derived([
    ...(collapsedSections.has('staged') ? [] : filteredStagedEntries),
    ...(collapsedSections.has('unstaged') ? [] : filteredUnstagedEntries),
    ...(collapsedSections.has('untracked') ? [] : filteredUntrackedEntries),
  ]);

  // On status change: invalidate cached diffs (they may be stale) and fix the selection.
  // Diffs are then loaded lazily for the selected file only (see the effect below) instead
  // of eagerly fetching every changed file's diff up front.
  $effect(() => {
    const entries = gitStatus.entries;
    const currentKeys = new Set(entries.map(e => fileKey(e)));

    untrack(() => {
      fileDiffs = {};

      // Auto-select first file if no selection or selection no longer exists
      if (entries.length > 0 && (selectedFileKey === null || !currentKeys.has(selectedFileKey))) {
        selectedFileKey = fileKey(entries[0]);
      } else if (entries.length === 0) {
        selectedFileKey = null;
      }
    });
  });

  // Lazily load the selected file's diff (plus its immediate neighbors, so arrow-key
  // navigation feels instant) whenever the selection or the file list changes.
  $effect(() => {
    const entry = selectedEntry;
    const ordered = visibleEntries;
    untrack(() => {
      hunkIdx = 0;
      if (!entry) return;
      loadDiff(entry);
      const idx = ordered.findIndex(e => fileKey(e) === fileKey(entry));
      if (idx >= 0) {
        if (ordered[idx + 1]) loadDiff(ordered[idx + 1]);
        if (ordered[idx - 1]) loadDiff(ordered[idx - 1]);
      }
    });
  });

  function fileKey(entry: GitStatusEntry): string {
    return `${entry.filePath}:${entry.staged}`;
  }

  async function loadDiff(entry: GitStatusEntry, forceReload = false) {
    const key = fileKey(entry);
    if (!forceReload && fileDiffs[key] !== undefined) return;
    try {
      // Pass `staged` so the index-vs-HEAD and working-tree-vs-index diffs differ
      // for a path that appears in both the Staged and Changes sections.
      const diff = await window.groveBench.getFileDiff(sessionId, entry.filePath, entry.staged);
      fileDiffs = { ...fileDiffs, [key]: diff };
    } catch {
      fileDiffs = { ...fileDiffs, [key]: { kind: 'text', patch: '' } };
    }
  }

  function selectFile(entry: GitStatusEntry) {
    selectedFileKey = fileKey(entry);
    loadDiff(entry);
  }

  function toggleEditHistory(key: string) {
    const next = new Set(editHistoryExpanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    editHistoryExpanded = next;
  }

  function toggleSection(section: string) {
    const next = new Set(collapsedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    collapsedSections = next;
  }

  // Staging + commit
  let commitMessage = $state('');
  let committing = $state(false);
  let commitError = $state('');

  function stageEntry(entry: GitStatusEntry) {
    gitStatusStore.stageFile(sessionId, entry.filePath).catch(e => console.error('Failed to stage:', e));
  }

  function unstageEntry(entry: GitStatusEntry) {
    gitStatusStore.unstageFile(sessionId, entry.filePath).catch(e => console.error('Failed to unstage:', e));
  }

  async function stageAll(entries: GitStatusEntry[]) {
    const paths = [...new Set(entries.map(e => e.filePath))];
    for (const p of paths) {
      try { await gitStatusStore.stageFile(sessionId, p); } catch (e) { console.error('Failed to stage:', e); }
    }
  }

  async function unstageAll(entries: GitStatusEntry[]) {
    const paths = [...new Set(entries.map(e => e.filePath))];
    for (const p of paths) {
      try { await gitStatusStore.unstageFile(sessionId, p); } catch (e) { console.error('Failed to unstage:', e); }
    }
  }

  async function doCommit() {
    if (!commitMessage.trim() || stagedEntries.length === 0 || committing) return;
    committing = true;
    commitError = '';
    try {
      await gitStatusStore.commit(sessionId, commitMessage);
      commitMessage = '';
    } catch (e: any) {
      commitError = e?.message || 'Commit failed';
    } finally {
      committing = false;
    }
  }

  // Hunk navigation
  let diffContainer = $state<HTMLDivElement | null>(null);
  let hunkIdx = $state(0);

  function gotoHunk(dir: 1 | -1) {
    if (!diffContainer) return;
    const hunks = diffContainer.querySelectorAll('[data-hunk]');
    if (hunks.length === 0) return;
    hunkIdx = Math.max(0, Math.min(hunks.length - 1, hunkIdx + dir));
    (hunks[hunkIdx] as HTMLElement)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Diff-pane keyboard shortcuts. Only act when this pane is actually visible
  // (offsetParent is null while the tab is hidden via `display:none`) and the user
  // isn't typing into an input/textarea.
  function handleShortcuts(e: KeyboardEvent) {
    if (!diffContainer || diffContainer.offsetParent === null) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!selectedEntry) return;
    switch (e.key) {
      case 'n': e.preventDefault(); gotoHunk(1); break;
      case 'p': e.preventDefault(); gotoHunk(-1); break;
      case 'v': e.preventDefault(); sideBySide = !sideBySide; break;
      case 's': e.preventDefault(); selectedEntry.staged ? unstageEntry(selectedEntry) : stageEntry(selectedEntry); break;
    }
  }

  // Entry pending a destructive revert/discard, awaiting confirmation (null = dialog closed).
  let confirmEntry = $state<GitStatusEntry | null>(null);

  function confirmRevert() {
    const entry = confirmEntry;
    confirmEntry = null;
    if (entry) revertFile(entry);
  }

  async function revertFile(entry: GitStatusEntry) {
    const key = fileKey(entry);
    revertingFiles = new Set([...revertingFiles, key]);
    try {
      await gitStatusStore.revertFile(sessionId, entry.filePath, entry.staged);
    } catch (e) {
      console.error('Failed to revert file:', e);
    } finally {
      const next = new Set(revertingFiles);
      next.delete(key);
      revertingFiles = next;
    }
  }

  function getDiffLines(entry: GitStatusEntry): DiffLine[] {
    const result = fileDiffs[fileKey(entry)];
    if (result && result.kind === 'text' && result.patch) return parseDiffLines(result.patch);
    return [];
  }

  function openInEditor(filePath: string) {
    window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
  }

  function fileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1];
  }

  function dirPath(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/') + '/';
  }

  function statusBadge(status: string): { label: string; color: string } {
    switch (status) {
      case 'modified': return { label: 'M', color: 'text-yellow-400' };
      case 'added': return { label: 'A', color: 'text-green-400' };
      case 'deleted': return { label: 'D', color: 'text-red-400' };
      case 'renamed': return { label: 'R', color: 'text-blue-400' };
      case 'copied': return { label: 'C', color: 'text-blue-400' };
      case 'untracked': return { label: '?', color: 'text-muted-foreground' };
      default: return { label: '?', color: 'text-muted-foreground' };
    }
  }

  function refreshStatus() {
    gitStatusStore.refresh(sessionId);
  }

  function handleFileListKeydown(e: KeyboardEvent) {
    if (visibleEntries.length === 0) return;
    const currentIdx = visibleEntries.findIndex(entry => fileKey(entry) === selectedFileKey);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(currentIdx + 1, visibleEntries.length - 1);
      selectFile(visibleEntries[next]);
      scrollSidebarItemIntoView(fileKey(visibleEntries[next]));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(currentIdx - 1, 0);
      selectFile(visibleEntries[next]);
      scrollSidebarItemIntoView(fileKey(visibleEntries[next]));
    }
  }

  function scrollSidebarItemIntoView(key: string) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-file-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
</script>

{#snippet diffStat(entry: GitStatusEntry)}
  {#if entry.additions !== undefined || entry.deletions !== undefined}
    <span class="shrink-0 text-[10px] tabular-nums flex items-center gap-1">
      {#if entry.additions}<span class="text-green-400">+{entry.additions}</span>{/if}
      {#if entry.deletions}<span class="text-red-400">−{entry.deletions}</span>{/if}
    </span>
  {/if}
{/snippet}

{#snippet sidebarFileItem(entry: GitStatusEntry)}
  {@const key = fileKey(entry)}
  {@const badge = statusBadge(entry.status)}
  {@const isSelected = key === selectedFileKey}
  <button
    onclick={() => selectFile(entry)}
    data-file-key={key}
    class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left border-l-2 transition-colors
      {isSelected ? 'bg-sidebar-accent text-sidebar-accent-foreground border-primary' : 'border-transparent hover:bg-sidebar-accent/50'}"
  >
    <span class="font-bold {badge.color} shrink-0 w-3 text-center">{badge.label}</span>
    <div class="min-w-0 flex-1">
      <div class="truncate">{fileName(entry.filePath)}</div>
      {#if dirPath(entry.filePath)}
        <div class="truncate text-[10px] text-muted-foreground/60">{dirPath(entry.filePath)}</div>
      {/if}
    </div>
    {@render diffStat(entry)}
    {#if entry.staged}
      <span class="text-[10px] text-green-400 shrink-0">S</span>
    {/if}
  </button>
{/snippet}

{#snippet sidebarSectionHeader(title: string, sectionKey: string, count: number, colorClass: string, entries: GitStatusEntry[], mode: 'stage' | 'unstage' | 'none')}
  {#if count > 0}
    <div class="flex items-center w-full bg-card/30 group/sec">
      <button
        onclick={() => toggleSection(sectionKey)}
        class="flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground flex-1 min-w-0 text-left"
      >
        <svg class="w-2.5 h-2.5 transition-transform {collapsedSections.has(sectionKey) ? '' : 'rotate-90'}" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
        </svg>
        <span class={colorClass}>{title}</span>
        <span class="text-muted-foreground/60">{count}</span>
      </button>
      {#if mode === 'stage'}
        <button onclick={() => stageAll(entries)} class="px-2 py-1 text-[10px] text-muted-foreground hover:text-green-400 shrink-0 opacity-0 group-hover/sec:opacity-100">stage all</button>
      {:else if mode === 'unstage'}
        <button onclick={() => unstageAll(entries)} class="px-2 py-1 text-[10px] text-muted-foreground hover:text-yellow-400 shrink-0 opacity-0 group-hover/sec:opacity-100">unstage all</button>
      {/if}
    </div>
  {/if}
{/snippet}

<svelte:window onkeydown={handleShortcuts} />

{#if isRunning && gitStatus.entries.length === 0}
  <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground text-sm relative overflow-hidden">
    {#each Array(20) as _, i}
      <span
        class="blue-pixel absolute"
        style="
          width: 4px; height: 4px;
          top: {Math.round((8 + (((i * 37 + 13) * 7) % 84)) / 100 * 800 / 6) * 6}px;
          left: {Math.round((5 + (((i * 53 + 7) * 11) % 90)) / 100 * 1400 / 6) * 6}px;
          animation-delay: {(i * 1.3) % 6}s;
        "
      ></span>
    {/each}
    <div class="flex items-center gap-2 relative z-10">
      <span class="w-2.5 h-2.5 bg-primary animate-pulse"></span>
      Agent is working... changes will appear when the turn completes.
    </div>
  </div>
{:else if gitStatus.entries.length === 0}
  <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground text-sm relative overflow-hidden">
    {#each Array(20) as _, i}
      <span
        class="blue-pixel absolute"
        style="
          width: 4px; height: 4px;
          top: {Math.round((8 + (((i * 37 + 13) * 7) % 84)) / 100 * 800 / 6) * 6}px;
          left: {Math.round((5 + (((i * 53 + 7) * 11) % 90)) / 100 * 1400 / 6) * 6}px;
          animation-delay: {(i * 1.3) % 6}s;
        "
      ></span>
    {/each}
    <span class="relative z-10">Working tree clean</span>
  </div>
{:else}
  <div class="flex-1 flex overflow-hidden">
    <!-- Left: File sidebar -->
    <div
      class="w-56 flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset"
      tabindex="0"
      onkeydown={handleFileListKeydown}
    >
      <!-- Sidebar header: search + summary -->
      <div class="border-b border-border px-3 py-2 shrink-0">
        <div class="relative">
          <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            bind:this={searchInputEl}
            bind:value={searchQuery}
            onfocus={() => searchFocused = true}
            onblur={() => { setTimeout(() => searchFocused = false, 150); }}
            onkeydown={handleSearchKeydown}
            type="text"
            placeholder="Filter files..."
            class="w-full text-xs bg-background/50 border border-border/50 px-2 py-1 pl-7 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
          {#if searchQuery}
            <button
              onclick={() => { searchQuery = ''; searchInputEl?.focus(); }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          {/if}

          <!-- Dropdown -->
          {#if showDropdown}
            <div class="absolute left-0 right-0 top-full mt-1 bg-card border border-border shadow-lg max-h-56 overflow-y-auto z-50">
              {#each dropdownEntries as entry, i (entry.filePath + ':' + entry.staged)}
                {@const badge = statusBadge(entry.status)}
                <button
                  onmousedown={() => selectDropdownEntry(entry)}
                  onmouseenter={() => dropdownIndex = i}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/50 {i === dropdownIndex ? 'bg-accent/50' : ''}"
                >
                  <span class="font-bold {badge.color} shrink-0">{badge.label}</span>
                  <span class="truncate">
                    <span class="text-muted-foreground">{dirPath(entry.filePath)}</span><span class="text-foreground">{fileName(entry.filePath)}</span>
                  </span>
                  {#if entry.staged}
                    <span class="ml-auto text-[10px] text-green-400 shrink-0">staged</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if searchQuery && filteredTotal !== gitStatus.entries.length && !showDropdown}
          <div class="text-[10px] text-muted-foreground mt-1">
            {filteredTotal} of {gitStatus.entries.length} files
          </div>
        {/if}
        <div class="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-2">
          <span>{gitStatus.entries.length} change{gitStatus.entries.length !== 1 ? 's' : ''}</span>
          {#if stagedEntries.length > 0}
            <span class="text-green-400">{stagedEntries.length}S</span>
          {/if}
          {#if unstagedEntries.length > 0}
            <span class="text-yellow-400">{unstagedEntries.length}M</span>
          {/if}
          {#if untrackedEntries.length > 0}
            <span class="text-muted-foreground/60">{untrackedEntries.length}?</span>
          {/if}
        </div>
      </div>

      <!-- Scrollable file list -->
      <div class="flex-1 overflow-y-auto">
        <!-- Staged -->
        {#if filteredStagedEntries.length > 0}
          {@render sidebarSectionHeader('Staged', 'staged', filteredStagedEntries.length, 'text-green-400', filteredStagedEntries, 'unstage')}
          {#if !collapsedSections.has('staged')}
            {#each filteredStagedEntries as entry (entry.filePath + ':staged')}
              {@render sidebarFileItem(entry)}
            {/each}
          {/if}
        {/if}

        <!-- Unstaged -->
        {#if filteredUnstagedEntries.length > 0}
          {@render sidebarSectionHeader('Changes', 'unstaged', filteredUnstagedEntries.length, 'text-yellow-400', filteredUnstagedEntries, 'stage')}
          {#if !collapsedSections.has('unstaged')}
            {#each filteredUnstagedEntries as entry (entry.filePath + ':unstaged')}
              {@render sidebarFileItem(entry)}
            {/each}
          {/if}
        {/if}

        <!-- Untracked -->
        {#if filteredUntrackedEntries.length > 0}
          {@render sidebarSectionHeader('Untracked', 'untracked', filteredUntrackedEntries.length, 'text-muted-foreground', filteredUntrackedEntries, 'stage')}
          {#if !collapsedSections.has('untracked')}
            {#each filteredUntrackedEntries as entry (entry.filePath + ':untracked')}
              {@render sidebarFileItem(entry)}
            {/each}
          {/if}
        {/if}
      </div>

      <!-- Commit box (shown when there are staged changes) -->
      {#if stagedEntries.length > 0}
        <div class="border-t border-border p-2 shrink-0 space-y-1.5">
          <textarea
            bind:value={commitMessage}
            placeholder="Commit message…"
            rows="2"
            onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCommit(); } }}
            class="w-full text-xs bg-background/50 border border-border/50 px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none"
          ></textarea>
          {#if commitError}
            <div class="text-[10px] text-destructive">{commitError}</div>
          {/if}
          <button
            onclick={doCommit}
            disabled={!commitMessage.trim() || committing}
            class="w-full text-xs px-2 py-1 bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {committing ? 'Committing…' : `Commit ${stagedEntries.length} file${stagedEntries.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      {/if}
    </div>

    <!-- Right: Diff viewer -->
    <div class="flex-1 flex flex-col overflow-hidden">
      {#if selectedEntry}
        {@const key = fileKey(selectedEntry)}
        {@const reverting = revertingFiles.has(key)}
        {@const diffResult = fileDiffs[key]}
        {@const diffLines = getDiffLines(selectedEntry)}
        {@const badge = statusBadge(selectedEntry.status)}
        {@const history = editHistoryByFile.get(selectedEntry.filePath)}
        {@const historyExpanded = editHistoryExpanded.has(key)}
        {@const isUntracked = selectedEntry.status === 'untracked'}

        <!-- Diff header -->
        <div class="border-b border-border bg-card/50 px-4 py-2 shrink-0 flex items-center gap-2 group/diff-hdr">
          <span class="text-xs font-bold {badge.color}">{badge.label}</span>

          <button
            onclick={() => openInEditor(selectedEntry.filePath)}
            class="text-xs text-foreground/80 hover:text-primary hover:underline cursor-pointer truncate"
            title="Open in editor"
          >
            <span class="text-muted-foreground">{dirPath(selectedEntry.filePath)}</span>{fileName(selectedEntry.filePath)}
          </button>

          {@render diffStat(selectedEntry)}

          {#if selectedEntry.origPath}
            <span class="text-xs text-muted-foreground truncate">← {selectedEntry.origPath}</span>
          {/if}

          <CopyButton text={selectedEntry.filePath} class="opacity-0 group-hover/diff-hdr:opacity-100 shrink-0" />

          {#if history && history.edits.length > 0}
            <button
              onclick={() => toggleEditHistory(key)}
              class="text-xs text-muted-foreground hover:text-foreground {historyExpanded ? 'text-foreground' : ''}"
              title="Show individual edits from this session"
            >
              {history.edits.length} edit{history.edits.length !== 1 ? 's' : ''}
            </button>
          {/if}

          <div class="ml-auto flex items-center gap-2">
            {#if hunkLineIndices(diffLines).length > 1}
              <div class="flex items-center text-muted-foreground" title="Jump between hunks">
                <button onclick={() => gotoHunk(-1)} class="hover:text-foreground px-0.5" aria-label="Previous hunk">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                </button>
                <button onclick={() => gotoHunk(1)} class="hover:text-foreground px-0.5" aria-label="Next hunk">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>
            {/if}
            {#if selectedEntry.staged}
              <button
                onclick={() => unstageEntry(selectedEntry)}
                class="text-xs px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                title="Unstage this file"
              >
                Unstage
              </button>
            {:else}
              <button
                onclick={() => stageEntry(selectedEntry)}
                class="text-xs px-2 py-0.5 border border-green-700/40 text-green-400 hover:bg-green-900/20 transition-colors"
                title="Stage this file"
              >
                Stage
              </button>
            {/if}
            <button
              onclick={() => sideBySide = !sideBySide}
              class="text-xs text-muted-foreground hover:text-foreground select-none"
            >
              {sideBySide ? 'unified' : 'side-by-side'}
            </button>
            <button
              onclick={refreshStatus}
              class="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              title="Refresh git status"
              disabled={isLoading}
            >
              <svg class="w-3.5 h-3.5 {isLoading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onclick={() => confirmEntry = selectedEntry}
              disabled={reverting}
              class="text-xs px-2 py-0.5 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              title={isUntracked ? 'Delete this untracked file' : 'Revert this file to its state before changes'}
            >
              {#if reverting}
                <span class="w-2 h-2 bg-destructive animate-pulse inline-block"></span>
              {:else}
                {isUntracked ? 'Discard' : 'Revert'}
              {/if}
            </button>
          </div>
        </div>

        <!-- Diff content -->
        <div class="flex-1 overflow-y-auto px-4 py-2" bind:this={diffContainer}>
          {#if diffResult?.kind === 'image'}
            <ImageDiffView {sessionId} filePath={selectedEntry.filePath} />
          {:else if diffResult?.kind === 'binary'}
            <div class="flex items-center gap-2 text-xs text-muted-foreground py-3 px-2 border border-border/50 bg-card/30">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Binary file — no text diff to display.
            </div>
          {:else if diffLines.length > 0}
            <DiffView lines={diffLines} {sideBySide} maxHeight="none" filePath={selectedEntry.filePath} />
          {:else}
            <div class="text-xs text-muted-foreground py-2">No diff available</div>
          {/if}

          <!-- Edit history sub-section -->
          {#if history && historyExpanded}
            <div class="mt-2 border-t border-border/50 pt-2">
              <div class="text-xs text-muted-foreground mb-1.5 font-medium">Edit History</div>
              {#each history.edits as edit, idx}
                {@const input = edit.toolInput as Record<string, unknown>}
                {@const editDiffLines = computeDiffLines(edit.toolName, input, selectedEntry.filePath)}
                {#if editDiffLines.length > 0}
                  <div class="mb-2 {idx > 0 ? 'border-t border-border/30 pt-2' : ''}">
                    <div class="text-[10px] text-muted-foreground/60 mb-1">
                      {edit.toolName} #{idx + 1}
                    </div>
                    <DiffView lines={editDiffLines} sideBySide={false} maxHeight="300px" filePath={selectedEntry.filePath} />
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <!-- No file selected -->
        <div class="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          Select a file to view changes
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Text-selection actions (Bookmark / To prompt) over the diff content -->
<SelectionMenu {sessionId} container={diffContainer} />

<!-- Confirmation for destructive revert/discard -->
<Dialog.Root open={confirmEntry !== null} onOpenChange={(v) => { if (!v) confirmEntry = null; }}>
  <Dialog.Content class="max-w-md">
    {#if confirmEntry}
      {@const isUntracked = confirmEntry.status === 'untracked'}
      <Dialog.Header>
        <Dialog.Title>{isUntracked ? 'Discard file?' : 'Revert file?'}</Dialog.Title>
        <Dialog.Description>
          {#if isUntracked}
            <span class="font-mono text-xs break-all">{confirmEntry.filePath}</span> will be permanently deleted from disk. This cannot be undone.
          {:else}
            <span class="font-mono text-xs break-all">{confirmEntry.filePath}</span> will be reset to its last committed state, discarding the changes shown here.
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => confirmEntry = null}>Cancel</Button>
        <Button variant="destructive" onclick={confirmRevert}>{isUntracked ? 'Discard' : 'Revert'}</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
