<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import DiffView, { computeDiffLines, parseDiffLines } from './DiffView.svelte';
  import type { DiffLine } from './DiffView.svelte';
  import CopyButton from './CopyButton.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let fileChanges = $derived(messageStore.getLastTurnFileChanges(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  // Per-file UI state
  let expandedFiles = $state<Set<string>>(new Set());
  let sideBySideFiles = $state<Set<string>>(new Set());
  let revertingFiles = $state<Set<string>>(new Set());
  let fileDiffs = $state<Record<string, string>>({});

  // Track the previous fileChanges identity to detect when they update
  let prevFileChangeKeys = $state<string>('');

  // Expand all files by default when changes arrive
  $effect(() => {
    const key = fileChanges.map(f => f.filePath).join('\0');
    if (fileChanges.length > 0 && key !== prevFileChangeKeys) {
      prevFileChangeKeys = key;
      expandedFiles = new Set(fileChanges.map(f => f.filePath));
      // Invalidate cached diffs and reload
      fileDiffs = {};
      for (const fc of fileChanges) {
        loadDiff(fc.filePath);
      }
    }
  });

  async function loadDiff(filePath: string) {
    if (fileDiffs[filePath] !== undefined) return;
    try {
      const diff = await window.groveBench.getFileDiff(sessionId, filePath);
      fileDiffs = { ...fileDiffs, [filePath]: diff };
    } catch {
      fileDiffs = { ...fileDiffs, [filePath]: '' };
    }
  }

  function toggleExpanded(filePath: string) {
    const next = new Set(expandedFiles);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    expandedFiles = next;
  }

  function toggleSideBySide(filePath: string) {
    const next = new Set(sideBySideFiles);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    sideBySideFiles = next;
  }

  async function revertFile(filePath: string) {
    revertingFiles = new Set([...revertingFiles, filePath]);
    try {
      await messageStore.revertFile(sessionId, filePath);
    } catch (e) {
      console.error('Failed to revert file:', e);
    } finally {
      const next = new Set(revertingFiles);
      next.delete(filePath);
      revertingFiles = next;
    }
  }

  function isReverted(filePath: string): boolean {
    return messageStore.isFileReverted(sessionId, filePath);
  }

  function getDiffLines(filePath: string, fc: typeof fileChanges[0]): DiffLine[] {
    // Prefer git diff if available (shows actual on-disk state)
    const gitDiff = fileDiffs[filePath];
    if (gitDiff) {
      return parseDiffLines(gitDiff);
    }
    // Fall back to tool input diff (from the last edit on this file)
    const input = fc.toolInput as Record<string, unknown>;
    return computeDiffLines(fc.toolName, input, filePath);
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

  let totalFiles = $derived(fileChanges.length);
  let revertedCount = $derived(fileChanges.filter(f => isReverted(f.filePath)).length);
  let acceptedCount = $derived(totalFiles - revertedCount);
</script>

{#if isRunning}
  <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
    <div class="flex items-center gap-2">
      <span class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
      Agent is working... changes will appear when the turn completes.
    </div>
  </div>
{:else if fileChanges.length === 0}
  <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
    No file changes in the last turn.
  </div>
{:else}
  <div class="flex-1 overflow-y-auto">
    <!-- Summary header -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50 sticky top-0 z-10">
      <span class="text-xs font-medium text-foreground">
        {totalFiles} file{totalFiles !== 1 ? 's' : ''} changed
      </span>
      {#if revertedCount > 0}
        <span class="text-xs text-muted-foreground">
          {acceptedCount} accepted, {revertedCount} reverted
        </span>
      {/if}
    </div>

    <!-- File list -->
    <div class="divide-y divide-border">
      {#each fileChanges as fc (fc.filePath)}
        {@const reverted = isReverted(fc.filePath)}
        {@const reverting = revertingFiles.has(fc.filePath)}
        {@const expanded = expandedFiles.has(fc.filePath)}
        {@const sideBySide = sideBySideFiles.has(fc.filePath)}
        {@const diffLines = getDiffLines(fc.filePath, fc)}
        {@const editCount = fc.edits.length}

        <div class="border-l-4 {reverted ? 'border-muted-foreground/30 opacity-60' : 'border-primary'}">
          <!-- File header -->
          <div class="flex items-center gap-2 px-4 py-2 group/file-hdr">
            <button
              onclick={() => toggleExpanded(fc.filePath)}
              class="text-muted-foreground hover:text-foreground shrink-0"
            >
              <svg class="w-3 h-3 transition-transform {expanded ? 'rotate-90' : ''}" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
              </svg>
            </button>

            <span class="text-xs font-bold {fc.toolName === 'Write' ? 'text-green-400' : 'text-primary'}">
              {fc.toolName === 'Write' ? '+new' : 'edit'}
            </span>

            <button
              onclick={() => openInEditor(fc.filePath)}
              class="text-xs text-foreground/80 hover:text-primary hover:underline cursor-pointer truncate"
              title="Open in editor"
            >
              <span class="text-muted-foreground">{dirPath(fc.filePath)}</span>{fileName(fc.filePath)}
            </button>

            <CopyButton text={fc.filePath} class="opacity-0 group-hover/file-hdr:opacity-100 shrink-0" />

            {#if editCount > 1}
              <span class="text-xs text-muted-foreground">({editCount} edits)</span>
            {/if}

            <div class="ml-auto flex items-center gap-2">
              {#if expanded && diffLines.length > 0 && fc.toolName === 'Edit'}
                <button
                  onclick={() => toggleSideBySide(fc.filePath)}
                  class="text-xs text-muted-foreground hover:text-foreground select-none"
                >
                  {sideBySide ? 'unified' : 'side-by-side'}
                </button>
              {/if}

              {#if reverted}
                <span class="text-xs text-muted-foreground flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
                  </svg>
                  reverted
                </span>
              {:else}
                <button
                  onclick={() => revertFile(fc.filePath)}
                  disabled={reverting}
                  class="text-xs px-2 py-0.5 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  title="Revert this file to its state before the agent's changes"
                >
                  {#if reverting}
                    <span class="w-2.5 h-2.5 border border-destructive border-t-transparent rounded-full animate-spin inline-block"></span>
                  {:else}
                    Revert
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <!-- Diff content (collapsible) -->
          {#if expanded && !reverted}
            <div class="px-4 pb-2">
              {#if diffLines.length > 0}
                <DiffView lines={diffLines} {sideBySide} maxHeight="500px" />
              {:else}
                <div class="text-xs text-muted-foreground py-2">No diff available</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
