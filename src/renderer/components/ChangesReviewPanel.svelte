<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import DiffView, { computeDiffLines, parseDiffLines } from './DiffView.svelte';
  import type { DiffLine } from './DiffView.svelte';
  import type { GitStatusEntry } from '../../shared/types.js';
  import CopyButton from './CopyButton.svelte';

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
  let expandedFiles = $state<Set<string>>(new Set());
  let sideBySideFiles = $state<Set<string>>(new Set());
  let editHistoryExpanded = $state<Set<string>>(new Set());
  let revertingFiles = $state<Set<string>>(new Set());
  let fileDiffs = $state<Record<string, string>>({});

  // Collapsed sections
  let collapsedSections = $state<Set<string>>(new Set());

  // Track previous entries to auto-expand new files
  let prevEntryKeys = $state<string>('');

  $effect(() => {
    const key = gitStatus.entries.map(e => `${e.filePath}:${e.staged}`).join('\0');
    if (gitStatus.entries.length > 0 && key !== prevEntryKeys) {
      prevEntryKeys = key;
      expandedFiles = new Set(gitStatus.entries.map(e => fileKey(e)));
      fileDiffs = {};
      for (const entry of gitStatus.entries) {
        loadDiff(entry.filePath);
      }
    }
  });

  function fileKey(entry: GitStatusEntry): string {
    return `${entry.filePath}:${entry.staged}`;
  }

  async function loadDiff(filePath: string) {
    if (fileDiffs[filePath] !== undefined) return;
    try {
      const diff = await window.groveBench.getFileDiff(sessionId, filePath);
      fileDiffs = { ...fileDiffs, [filePath]: diff };
    } catch {
      fileDiffs = { ...fileDiffs, [filePath]: '' };
    }
  }

  function toggleExpanded(key: string) {
    const next = new Set(expandedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedFiles = next;
  }

  function toggleSideBySide(key: string) {
    const next = new Set(sideBySideFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    sideBySideFiles = next;
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

  async function revertFile(entry: GitStatusEntry) {
    const key = fileKey(entry);
    revertingFiles = new Set([...revertingFiles, key]);
    try {
      await messageStore.revertFile(sessionId, entry.filePath, entry.staged);
    } catch (e) {
      console.error('Failed to revert file:', e);
    } finally {
      const next = new Set(revertingFiles);
      next.delete(key);
      revertingFiles = next;
    }
  }

  function getDiffLines(filePath: string): DiffLine[] {
    const gitDiff = fileDiffs[filePath];
    if (gitDiff) return parseDiffLines(gitDiff);
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
</script>

{#snippet fileRow(entry: GitStatusEntry)}
  {@const key = fileKey(entry)}
  {@const expanded = expandedFiles.has(key)}
  {@const sideBySide = sideBySideFiles.has(key)}
  {@const reverting = revertingFiles.has(key)}
  {@const diffLines = getDiffLines(entry.filePath)}
  {@const badge = statusBadge(entry.status)}
  {@const history = editHistoryByFile.get(entry.filePath)}
  {@const historyExpanded = editHistoryExpanded.has(key)}
  {@const canRevert = entry.status !== 'untracked'}

  <div class="border-l-4 {entry.staged ? 'border-green-500' : entry.status === 'untracked' ? 'border-muted-foreground/30' : 'border-primary'}">
    <!-- File header -->
    <div class="flex items-center gap-2 px-4 py-2 group/file-hdr">
      <button
        onclick={() => toggleExpanded(key)}
        class="text-muted-foreground hover:text-foreground shrink-0"
      >
        <svg class="w-3 h-3 transition-transform {expanded ? 'rotate-90' : ''}" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
        </svg>
      </button>

      <span class="text-xs font-bold {badge.color}">{badge.label}</span>

      <button
        onclick={() => openInEditor(entry.filePath)}
        class="text-xs text-foreground/80 hover:text-primary hover:underline cursor-pointer truncate"
        title="Open in editor"
      >
        <span class="text-muted-foreground">{dirPath(entry.filePath)}</span>{fileName(entry.filePath)}
      </button>

      {#if entry.origPath}
        <span class="text-xs text-muted-foreground truncate">← {entry.origPath}</span>
      {/if}

      <CopyButton text={entry.filePath} class="opacity-0 group-hover/file-hdr:opacity-100 shrink-0" />

      {#if history && history.edits.length > 0}
        <button
          onclick={() => toggleEditHistory(key)}
          class="text-xs text-muted-foreground hover:text-foreground"
          title="Show individual edits from this session"
        >
          {history.edits.length} edit{history.edits.length !== 1 ? 's' : ''}
        </button>
      {/if}

      <div class="ml-auto flex items-center gap-2">
        {#if expanded && diffLines.length > 0 && entry.status !== 'deleted'}
          <button
            onclick={() => toggleSideBySide(key)}
            class="text-xs text-muted-foreground hover:text-foreground select-none"
          >
            {sideBySide ? 'unified' : 'side-by-side'}
          </button>
        {/if}

        {#if canRevert}
          <button
            onclick={() => revertFile(entry)}
            disabled={reverting}
            class="text-xs px-2 py-0.5 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            title="Revert this file to its state before changes"
          >
            {#if reverting}
              <span class="w-2 h-2 bg-destructive animate-pulse inline-block"></span>
            {:else}
              Revert
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <!-- Diff content (collapsible) -->
    {#if expanded}
      <div class="px-4 pb-2">
        {#if diffLines.length > 0}
          <DiffView lines={diffLines} {sideBySide} maxHeight="500px" />
        {:else}
          <div class="text-xs text-muted-foreground py-2">No diff available</div>
        {/if}

        <!-- Edit history sub-section -->
        {#if history && historyExpanded}
          <div class="mt-2 border-t border-border/50 pt-2">
            <div class="text-xs text-muted-foreground mb-1.5 font-medium">Edit History</div>
            {#each history.edits as edit, idx}
              {@const input = edit.toolInput as Record<string, unknown>}
              {@const editDiffLines = computeDiffLines(edit.toolName, input, entry.filePath)}
              {#if editDiffLines.length > 0}
                <div class="mb-2 {idx > 0 ? 'border-t border-border/30 pt-2' : ''}">
                  <div class="text-[10px] text-muted-foreground/60 mb-1">
                    {edit.toolName} #{idx + 1}
                  </div>
                  <DiffView lines={editDiffLines} sideBySide={false} maxHeight="300px" />
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet sectionHeader(title: string, sectionKey: string, count: number, colorClass: string)}
  {#if count > 0}
    <button
      onclick={() => toggleSection(sectionKey)}
      class="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground w-full text-left bg-card/30"
    >
      <svg class="w-2.5 h-2.5 transition-transform {collapsedSections.has(sectionKey) ? '' : 'rotate-90'}" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
      </svg>
      <span class={colorClass}>{title}</span>
      <span class="text-muted-foreground/60">{count}</span>
    </button>
  {/if}
{/snippet}

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
  <div class="flex-1 overflow-y-auto">
    <!-- Summary header -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50 sticky top-0 z-10">
      <span class="text-xs font-medium text-foreground">
        {gitStatus.entries.length} change{gitStatus.entries.length !== 1 ? 's' : ''}
      </span>
      {#if stagedEntries.length > 0}
        <span class="text-xs text-green-400">{stagedEntries.length} staged</span>
      {/if}
      {#if unstagedEntries.length > 0}
        <span class="text-xs text-yellow-400">{unstagedEntries.length} unstaged</span>
      {/if}
      {#if untrackedEntries.length > 0}
        <span class="text-xs text-muted-foreground">{untrackedEntries.length} untracked</span>
      {/if}
      <button
        onclick={refreshStatus}
        class="ml-auto text-muted-foreground hover:text-foreground transition-colors p-0.5"
        title="Refresh git status"
        disabled={isLoading}
      >
        <svg class="w-3.5 h-3.5 {isLoading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>

    <!-- File sections -->
    <div class="divide-y divide-border">
      <!-- Staged -->
      {#if stagedEntries.length > 0}
        {@render sectionHeader('Staged Changes', 'staged', stagedEntries.length, 'text-green-400')}
        {#if !collapsedSections.has('staged')}
          {#each stagedEntries as entry (entry.filePath + ':staged')}
            {@render fileRow(entry)}
          {/each}
        {/if}
      {/if}

      <!-- Unstaged -->
      {#if unstagedEntries.length > 0}
        {@render sectionHeader('Changes', 'unstaged', unstagedEntries.length, 'text-yellow-400')}
        {#if !collapsedSections.has('unstaged')}
          {#each unstagedEntries as entry (entry.filePath + ':unstaged')}
            {@render fileRow(entry)}
          {/each}
        {/if}
      {/if}

      <!-- Untracked -->
      {#if untrackedEntries.length > 0}
        {@render sectionHeader('Untracked Files', 'untracked', untrackedEntries.length, 'text-muted-foreground')}
        {#if !collapsedSections.has('untracked')}
          {#each untrackedEntries as entry (entry.filePath + ':untracked')}
            {@render fileRow(entry)}
          {/each}
        {/if}
      {/if}
    </div>
  </div>
{/if}
