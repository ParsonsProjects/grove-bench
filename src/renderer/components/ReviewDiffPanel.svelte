<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import DiffView, { computeDiffLines, parseDiffLines } from './DiffView.svelte';
  import type { DiffLine, CommentAnchor, ContextGap } from './DiffView.svelte';
  import { hunkLineIndices } from '../lib/diff-highlight.js';
  import { withExpandableContext, reveal, expansionFor, type RevealedRanges } from '../lib/diff-context.js';
  import { buildReviewPrompt } from '../lib/review-prompt.js';
  import { reviewStore } from '../stores/review.svelte.js';
  import type { GitStatusEntry, FileDiffResult, FileLinesResult } from '../../shared/types.js';
  import CopyButton from './CopyButton.svelte';
  import ImageDiffView from './ImageDiffView.svelte';
  import SelectionMenu from './SelectionMenu.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';

  /**
   * Shared review UI: a file sidebar (search, sections, viewed marks, comment
   * counts) next to a diff viewer (word-level marks, expandable context,
   * line comments batched into one prompt). The Changes tab feeds it git
   * status; the Checkpoints tab feeds it a checkpoint comparison. Everything
   * source-specific (staging, revert, commit, scope, rewind) comes in through
   * props and snippets so this component never talks to git itself.
   */
  let {
    sessionId,
    sourceKey,
    entries,
    loading = false,
    changesLabel = 'Changes',
    loadDiff: fetchDiff,
    loadFileLines: fetchFileLines,
    onRefresh,
    onStage,
    onUnstage,
    onStageAll,
    onUnstageAll,
    shortcuts = {},
    commentContext,
    emptyTitle,
    emptyHint,
    emptyExtra,
    sidebarTop,
    sidebarSummaryExtra,
    sidebarFooter,
    headerActions,
    dialogs,
  }: {
    sessionId: string;
    /** Identity of what is being compared. When it changes every per-file
     *  cache (diffs, expansions, composer) resets. */
    sourceKey: string;
    entries: GitStatusEntry[];
    loading?: boolean;
    /** Heading for the unstaged section. */
    changesLabel?: string;
    loadDiff: (entry: GitStatusEntry) => Promise<FileDiffResult>;
    loadFileLines: (entry: GitStatusEntry) => Promise<FileLinesResult>;
    onRefresh?: () => void;
    /** Staging controls appear only when these are provided. */
    onStage?: (entry: GitStatusEntry) => void;
    onUnstage?: (entry: GitStatusEntry) => void;
    onStageAll?: (entries: GitStatusEntry[]) => void;
    onUnstageAll?: (entries: GitStatusEntry[]) => void;
    /** Extra single-key shortcuts acting on the selected file. */
    shortcuts?: Record<string, (entry: GitStatusEntry) => void>;
    /** Where the comments were made, for the prompt heading and so a comment
     *  only renders on the comparison it was written against. */
    commentContext?: string;
    emptyTitle: string;
    emptyHint?: string;
    emptyExtra?: Snippet;
    sidebarTop?: Snippet;
    sidebarSummaryExtra?: Snippet;
    sidebarFooter?: Snippet;
    headerActions?: Snippet<[GitStatusEntry]>;
    dialogs?: Snippet;
  } = $props();

  let isLoading = $derived(loading);
  let hasStaging = $derived(!!onStage && !!onUnstage);

  // Group entries by section
  let stagedEntries = $derived(entries.filter(e => e.staged));
  let unstagedEntries = $derived(entries.filter(e => !e.staged && e.status !== 'untracked'));
  let untrackedEntries = $derived(entries.filter(e => e.status === 'untracked'));

  // ── Viewed tracking ──
  let reviewState = $derived(reviewStore.bySession[sessionId]);
  function isViewed(entry: GitStatusEntry): boolean {
    reviewState;
    return reviewStore.isViewed(sessionId, entry.filePath, entry.contentHash);
  }
  function changedSinceViewed(entry: GitStatusEntry): boolean {
    reviewState;
    return reviewStore.changedSinceViewed(sessionId, entry.filePath, entry.contentHash);
  }
  let viewedCount = $derived.by(() => { reviewState; return reviewStore.viewedCount(sessionId, entries); });

  /** Toggle viewed; marking a file viewed moves on to the next unviewed file
   *  (like GitHub collapsing the file you just ticked). */
  function toggleViewed(entry: GitStatusEntry) {
    const next = !isViewed(entry);
    reviewStore.setViewed(sessionId, entry.filePath, entry.contentHash, next);
    if (next) {
      const ordered = visibleEntries;
      const idx = ordered.findIndex(e => fileKey(e) === fileKey(entry));
      const following = ordered.slice(idx + 1).find(e => !isViewed(e)) ?? ordered.slice(0, idx).find(e => !isViewed(e));
      if (following) { selectFile(following); scrollSidebarItemIntoView(fileKey(following)); }
    }
  }

  // ── Review comments (line-anchored, batched into one prompt) ──
  let comments = $derived.by(() => { reviewState; return reviewStore.getComments(sessionId); });
  /** Comments written against this comparison (line numbers only make sense here). */
  let sourceComments = $derived(comments.filter(c => (c.context ?? '') === (commentContext ?? '')));
  let composer = $state<CommentAnchor | null>(null);
  function commentCountFor(filePath: string): number {
    return sourceComments.filter(c => c.filePath === filePath).length;
  }

  // Edit history from tool calls (for the expandable sub-section)
  let editHistory = $derived(messageStore.getLastTurnFileChanges(sessionId));
  let editHistoryByFile = $derived(
    new Map(editHistory.map(fc => [fc.filePath, fc]))
  );

  // Per-file UI state
  let selectedFileKey = $state<string | null>(null);
  let sideBySide = $state(settingsStore.current.diffViewMode === 'side-by-side');
  let editHistoryExpanded = $state<Set<string>>(new Set());
  let fileDiffs = $state<Record<string, FileDiffResult>>({});

  // Search filter
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchFocused = $state(false);
  let dropdownIndex = $state(-1);

  // Derived: selected entry
  let selectedEntry = $derived(
    entries.find(e => fileKey(e) === selectedFileKey) ?? null
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

  // On status change: drop cached diffs for entries that disappeared, fix the
  // selection, and re-fetch the selected file's diff in place. The previous
  // patch stays on screen until the new one arrives (stale-while-revalidate),
  // so a working tree that changes mid-turn updates like a live diff view
  // instead of blanking and reloading on every git status refresh.
  let lastSourceKey = '';
  $effect(() => {
    const list = entries;
    const key = sourceKey;
    const currentKeys = new Set(list.map(e => fileKey(e)));

    untrack(() => {
      // A source switch changes what every diff means; drop the cache wholesale.
      const scopeChanged = key !== lastSourceKey;
      lastSourceKey = key;
      const kept: Record<string, FileDiffResult> = {};
      if (!scopeChanged) {
        for (const [key, diff] of Object.entries(fileDiffs)) {
          if (currentKeys.has(key)) kept[key] = diff;
        }
      }
      fileDiffs = kept;
      if (scopeChanged) { revealedByKey = {}; fileLinesByKey = {}; composer = null; }

      // Auto-select first file if no selection or selection no longer exists
      if (list.length > 0 && (selectedFileKey === null || !currentKeys.has(selectedFileKey))) {
        selectedFileKey = fileKey(list[0]);
      } else if (list.length === 0) {
        selectedFileKey = null;
      }

      loadSelectedAndNeighbors(true);
    });
  });

  // When the user moves to another file: reset hunk position and lazily load
  // its diff (plus immediate neighbors, so arrow-key navigation feels instant).
  // Keyed on the file key rather than the entry object so a status refresh that
  // keeps the same file selected doesn't reset the hunk position.
  $effect(() => {
    selectedFileKey;
    untrack(() => {
      hunkIdx = 0;
      loadSelectedAndNeighbors(false);
    });
  });

  function loadSelectedAndNeighbors(forceReload: boolean) {
    const entry = selectedEntry;
    if (!entry) return;
    loadDiff(entry, forceReload);
    const ordered = visibleEntries;
    const idx = ordered.findIndex(e => fileKey(e) === fileKey(entry));
    if (idx >= 0) {
      if (ordered[idx + 1]) loadDiff(ordered[idx + 1], forceReload);
      if (ordered[idx - 1]) loadDiff(ordered[idx - 1], forceReload);
    }
  }

  function fileKey(entry: GitStatusEntry): string {
    return `${entry.filePath}:${entry.staged}`;
  }

  // Per-file request sequence so an older in-flight fetch can't overwrite a
  // newer one when refreshes overlap. A key is in flight while its latest
  // request has not resolved yet.
  const diffRequestSeq = new Map<string, number>();
  const diffInFlight = new Set<string>();

  async function loadDiff(entry: GitStatusEntry, forceReload = false) {
    const key = fileKey(entry);
    if (!forceReload && (fileDiffs[key] !== undefined || diffInFlight.has(key))) return;
    const seq = (diffRequestSeq.get(key) ?? 0) + 1;
    diffRequestSeq.set(key, seq);
    diffInFlight.add(key);
    let diff: FileDiffResult;
    try {
      diff = await fetchDiff(entry);
    } catch {
      diff = { kind: 'text', patch: '' };
    }
    if (diffRequestSeq.get(key) !== seq) return;
    diffInFlight.delete(key);
    fileDiffs = { ...fileDiffs, [key]: diff };
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

  function stageEntry(entry: GitStatusEntry) { onStage?.(entry); }
  function unstageEntry(entry: GitStatusEntry) { onUnstage?.(entry); }

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
      case 's': if (hasStaging) { e.preventDefault(); selectedEntry.staged ? unstageEntry(selectedEntry) : stageEntry(selectedEntry); } break;
      case 'x': e.preventDefault(); toggleViewed(selectedEntry); break;
      default: {
        const extra = shortcuts[e.key];
        if (extra) { e.preventDefault(); extra(selectedEntry); }
      }
    }
  }

  // Parsed lines for the selected file, memoized on the patch text: neighbor
  // prefetches and git-status refreshes reassign `fileDiffs` several times per
  // selection, and each reassignment would otherwise reparse (and re-highlight)
  // the whole patch.
  let parsedDiff: { key: string; patch: string; lines: DiffLine[] } | null = null;
  let selectedDiffLines = $derived.by((): DiffLine[] => {
    const entry = selectedEntry;
    if (!entry) return [];
    const key = fileKey(entry);
    const result = fileDiffs[key];
    if (!result || result.kind !== 'text' || !result.patch) return [];
    if (parsedDiff && parsedDiff.key === key && parsedDiff.patch === result.patch) return parsedDiff.lines;
    const lines = parseDiffLines(result.patch);
    parsedDiff = { key, patch: result.patch, lines };
    return lines;
  });
  let selectedHunkCount = $derived(hunkLineIndices(selectedDiffLines).length);

  // ── Expandable context ──
  // Revealed new-side line ranges and the new-side file lines, per file key.
  // Both reset when that file's patch changes (the line numbers would be stale).
  let revealedByKey = $state<Record<string, RevealedRanges>>({});
  let fileLinesByKey = $state<Record<string, string[] | null>>({});
  let patchSeen: Record<string, string> = {};
  $effect(() => {
    const entry = selectedEntry;
    if (!entry) return;
    const key = fileKey(entry);
    const result = fileDiffs[key];
    const patch = result?.kind === 'text' ? result.patch : '';
    untrack(() => {
      if (patchSeen[key] !== undefined && patchSeen[key] !== patch) {
        const { [key]: _r, ...restR } = revealedByKey; revealedByKey = restR;
        const { [key]: _f, ...restF } = fileLinesByKey; fileLinesByKey = restF;
      }
      patchSeen[key] = patch;
    });
  });
  let displayLines = $derived.by((): DiffLine[] => {
    const entry = selectedEntry;
    if (!entry) return [];
    const key = fileKey(entry);
    return withExpandableContext(selectedDiffLines, fileLinesByKey[key] ?? null, revealedByKey[key] ?? []);
  });

  async function expandContext(gap: ContextGap, dir: 'up' | 'down' | 'all') {
    const entry = selectedEntry;
    if (!entry) return;
    const key = fileKey(entry);
    if (fileLinesByKey[key] === undefined) {
      try {
        const res = await fetchFileLines(entry);
        fileLinesByKey = { ...fileLinesByKey, [key]: res?.lines ?? null };
      } catch {
        fileLinesByKey = { ...fileLinesByKey, [key]: null };
      }
    }
    const lines = fileLinesByKey[key];
    if (!lines) return;
    // Clamp the gap to the real file length now that we know it.
    const clamped: ContextGap = { ...gap, toNew: Math.min(gap.toNew, lines.length) };
    if (clamped.toNew < clamped.fromNew) return;
    const [from, to] = expansionFor(clamped, dir);
    revealedByKey = { ...revealedByKey, [key]: reveal(revealedByKey[key] ?? [], from, to) };
  }

  // ── Review comment handlers ──
  function lineTextFor(side: 'old' | 'new', from: number, to: number): string {
    const out: string[] = [];
    for (const l of displayLines) {
      const n = side === 'old' ? l.oldLineNum : l.newLineNum;
      if (n === undefined || n < from || n > to) continue;
      if (side === 'old' && l.type === 'add') continue;
      if (side === 'new' && l.type === 'del') continue;
      out.push(l.text);
    }
    return out.join('\n');
  }

  function onAddComment(anchor: { side: 'old' | 'new'; lineNum: number; text: string; shiftKey: boolean }) {
    if (composer && anchor.shiftKey && composer.side === anchor.side) {
      composer = {
        side: composer.side,
        startLine: Math.min(composer.startLine, anchor.lineNum),
        endLine: Math.max(composer.endLine, anchor.lineNum),
      };
      return;
    }
    composer = { side: anchor.side, startLine: anchor.lineNum, endLine: anchor.lineNum };
  }

  function saveComment(body: string) {
    const entry = selectedEntry;
    const c = composer;
    if (!entry || !c) return;
    reviewStore.addComment(sessionId, {
      filePath: entry.filePath,
      side: c.side,
      startLine: c.startLine,
      endLine: c.endLine,
      snippet: lineTextFor(c.side, c.startLine, c.endLine),
      body,
      context: commentContext,
    });
    composer = null;
  }

  let sendingReview = $state(false);
  function sendReview() {
    if (comments.length === 0 || sendingReview) return;
    sendingReview = true;
    try {
      const prompt = buildReviewPrompt(comments);
      messageStore.submitMessage(sessionId, { displayText: prompt, outgoing: prompt });
      reviewStore.clearComments(sessionId);
      composer = null;
      messageStore.setActiveTab(sessionId, 'activity');
    } finally {
      sendingReview = false;
    }
  }
  function reviewToPrompt() {
    if (comments.length === 0) return;
    messageStore.appendToPrompt(sessionId, buildReviewPrompt(comments));
    reviewStore.clearComments(sessionId);
    composer = null;
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
  {@const viewed = isViewed(entry)}
  {@const changed = changedSinceViewed(entry)}
  {@const nComments = commentCountFor(entry.filePath)}
  <button
    onclick={() => selectFile(entry)}
    data-file-key={key}
    data-viewed={viewed ? 'true' : undefined}
    data-changed-since-viewed={changed ? 'true' : undefined}
    class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left border-l-2 transition-colors
      {isSelected ? 'bg-sidebar-accent text-sidebar-accent-foreground border-primary' : 'border-transparent hover:bg-sidebar-accent/50'}
      {viewed && !isSelected ? 'opacity-60' : ''}"
  >
    <span class="font-bold {badge.color} shrink-0 w-3 text-center">{badge.label}</span>
    <div class="min-w-0 flex-1">
      <div class="truncate">{fileName(entry.filePath)}</div>
      {#if dirPath(entry.filePath)}
        <div class="truncate text-[10px] text-muted-foreground/60">{dirPath(entry.filePath)}</div>
      {/if}
    </div>
    {#if nComments > 0}
      <span class="shrink-0 text-[10px] text-primary flex items-center gap-0.5" title="{nComments} review comment{nComments === 1 ? '' : 's'}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h8m-8 4h5m-9 6l3-3h11a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14z"/></svg>{nComments}
      </span>
    {/if}
    {@render diffStat(entry)}
    {#if entry.staged}
      <span class="text-[10px] text-green-400 shrink-0">S</span>
    {/if}
    {#if changed}
      <span class="shrink-0 w-1.5 h-1.5 bg-yellow-400" title="Changed since you viewed it"></span>
    {:else if viewed}
      <svg class="w-3 h-3 shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Viewed"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
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
      {#if mode === 'stage' && onStageAll}
        <button onclick={() => onStageAll(entries)} class="px-2 py-1 text-[10px] text-muted-foreground hover:text-green-400 shrink-0 opacity-0 group-hover/sec:opacity-100">stage all</button>
      {:else if mode === 'unstage' && onUnstageAll}
        <button onclick={() => onUnstageAll(entries)} class="px-2 py-1 text-[10px] text-muted-foreground hover:text-yellow-400 shrink-0 opacity-0 group-hover/sec:opacity-100">unstage all</button>
      {/if}
    </div>
  {/if}
{/snippet}

<svelte:window onkeydown={handleShortcuts} />

{#if entries.length === 0}
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
    <div class="relative z-10 flex flex-col items-center gap-2">
      <span>{emptyTitle}</span>
      {#if emptyExtra}{@render emptyExtra()}{/if}
      {#if emptyHint}
        <span class="text-xs text-muted-foreground/60 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
          {emptyHint}
        </span>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex-1 flex overflow-hidden">
    <!-- Left: File sidebar -->
    <div
      class="w-56 flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset"
      role="listbox"
      aria-label="Changed files"
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
              aria-label="Clear filter"
              title="Clear filter"
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
        {#if searchQuery && filteredTotal !== entries.length && !showDropdown}
          <div class="text-[10px] text-muted-foreground mt-1">
            {filteredTotal} of {entries.length} files
          </div>
        {/if}
        {#if sidebarTop}
          <div class="mt-1.5 flex items-center gap-2">{@render sidebarTop()}</div>
        {/if}
        <div class="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-2 whitespace-nowrap">
          {#if sidebarSummaryExtra}{@render sidebarSummaryExtra()}{/if}
          <span>{entries.length} change{entries.length !== 1 ? 's' : ''}</span>
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
        {#if viewedCount > 0}
          <div class="text-[10px] text-green-400/80 mt-1 flex items-center gap-1" title="Files marked viewed (press x on the selected file)">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
            {viewedCount} of {entries.length} viewed
          </div>
        {/if}
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

        <!-- Unstaged (or, in branch scope, everything tracked since the base) -->
        {#if filteredUnstagedEntries.length > 0}
          {@render sidebarSectionHeader(changesLabel, 'unstaged', filteredUnstagedEntries.length, 'text-yellow-400', filteredUnstagedEntries, hasStaging ? 'stage' : 'none')}
          {#if !collapsedSections.has('unstaged')}
            {#each filteredUnstagedEntries as entry (entry.filePath + ':unstaged')}
              {@render sidebarFileItem(entry)}
            {/each}
          {/if}
        {/if}

        <!-- Untracked -->
        {#if filteredUntrackedEntries.length > 0}
          {@render sidebarSectionHeader('Untracked', 'untracked', filteredUntrackedEntries.length, 'text-muted-foreground', filteredUntrackedEntries, hasStaging ? 'stage' : 'none')}
          {#if !collapsedSections.has('untracked')}
            {#each filteredUntrackedEntries as entry (entry.filePath + ':untracked')}
              {@render sidebarFileItem(entry)}
            {/each}
          {/if}
        {/if}
      </div>

      {#if sidebarFooter}{@render sidebarFooter()}{/if}
    </div>

    <!-- Right: Diff viewer -->
    <div class="flex-1 flex flex-col overflow-hidden">
      {#if selectedEntry}
        {@const key = fileKey(selectedEntry)}
        {@const diffResult = fileDiffs[key]}
        {@const diffLines = selectedDiffLines}
        {@const badge = statusBadge(selectedEntry.status)}
        {@const history = editHistoryByFile.get(selectedEntry.filePath)}
        {@const historyExpanded = editHistoryExpanded.has(key)}

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
            {#if selectedHunkCount > 1}
              <div class="flex items-center text-muted-foreground" title="Jump between hunks">
                <button onclick={() => gotoHunk(-1)} class="hover:text-foreground px-0.5" aria-label="Previous hunk">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                </button>
                <button onclick={() => gotoHunk(1)} class="hover:text-foreground px-0.5" aria-label="Next hunk">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>
            {/if}
            <label class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none" title="Mark this file as viewed (x). Clears automatically if the file changes again.">
              <input type="checkbox" checked={isViewed(selectedEntry)} onchange={() => toggleViewed(selectedEntry)} class="accent-green-500" />
              Viewed
              {#if changedSinceViewed(selectedEntry)}
                <span class="text-[10px] text-yellow-400">· changed since</span>
              {/if}
            </label>
            {#if !hasStaging}
              <!-- No staging for this source (branch scope / checkpoints): the diff doesn't map onto the index. -->
            {:else if selectedEntry.staged}
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
            {#if onRefresh}
            <button
              onclick={onRefresh}
              class="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              title="Refresh"
              disabled={isLoading}
            >
              <svg class="w-3.5 h-3.5 {isLoading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {/if}
            {#if headerActions}{@render headerActions(selectedEntry)}{/if}
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
            <DiffView
              lines={displayLines}
              {sideBySide}
              maxHeight="none"
              filePath={selectedEntry.filePath}
              onExpand={expandContext}
              comments={sourceComments.filter(c => c.filePath === selectedEntry.filePath)}
              {composer}
              {onAddComment}
              onSaveComment={saveComment}
              onCancelComment={() => composer = null}
              onUpdateComment={(id, body) => reviewStore.updateComment(sessionId, id, body)}
              onRemoveComment={(id) => reviewStore.removeComment(sessionId, id)}
            />
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
        {#if comments.length > 0}
          <div data-review-bar class="border-t border-primary/30 bg-card/60 px-4 py-1.5 shrink-0 flex items-center gap-2 text-xs">
            <span class="text-foreground/80">{comments.length} review comment{comments.length === 1 ? '' : 's'}</span>
            <span class="text-muted-foreground/60">across {new Set(comments.map(c => c.filePath)).size} file{new Set(comments.map(c => c.filePath)).size === 1 ? '' : 's'}</span>
            <div class="ml-auto flex items-center gap-1.5">
              <button onclick={() => { if (confirm('Discard all review comments?')) { reviewStore.clearComments(sessionId); composer = null; } }} class="px-2 py-0.5 text-muted-foreground hover:text-destructive">Discard</button>
              <button onclick={reviewToPrompt} class="px-2 py-0.5 border border-border text-foreground/80 hover:bg-accent hover:text-accent-foreground" title="Put the batched comments into the prompt so you can edit before sending">To prompt</button>
              <button onclick={sendReview} disabled={sendingReview} class="px-2 py-0.5 bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40" title="Send all comments to the agent as one prompt (queued if it is busy)">
                Send to agent
              </button>
            </div>
          </div>
        {/if}
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

{#if dialogs}{@render dialogs()}{/if}
