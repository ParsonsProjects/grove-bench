<script lang="ts">
  import { checkpointStore, FULL_THREAD_UUID, type CheckpointDiffMode } from '../stores/checkpoints.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import ReviewDiffPanel from './ReviewDiffPanel.svelte';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { conversationAgent } from '../lib/session-sprite-state.js';
  import { panelStore } from '../stores/panels.svelte.js';
  import PanelToggle from './PanelToggle.svelte';
  import type { DiffStats, GitStatusEntry } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let checkpoints = $derived(checkpointStore.getCheckpoints(sessionId));
  let isLoading = $derived(checkpointStore.isLoading(sessionId));
  let selectedUuid = $derived(checkpointStore.getSelected(sessionId));
  let files = $derived(checkpointStore.getFiles(sessionId));
  let sourceKey = $derived(checkpointStore.getSourceKey(sessionId));
  let isDiffLoading = $derived(checkpointStore.isDiffLoading(sessionId));
  let rewindPoints = $derived(messageStore.getRewindPoints(sessionId));
  let history = $derived(checkpointStore.getHistory(sessionId));
  let diffMode = $derived(checkpointStore.getDiffMode(sessionId));
  /** The conversation's agent on its bench above the empty messages. */
  let groveAgent = $derived(settingsStore.current.groveCharacters ? conversationAgent(sessionId) : null);
  /** The turn list folded down to a rail of turn numbers. */
  let listCollapsed = $derived(panelStore.isCollapsed('checkpointList'));
  let rewinding = $state(false);
  let error = $state('');
  /** The rewind waiting on Confirm: each one discards work, and nothing
   *  keeps the files as they are now, so none runs on the first click. */
  let confirming = $state<'files' | 'all' | 'conversation' | null>(null);
  // Another checkpoint, or none, drops it.
  $effect(() => {
    void selectedUuid;
    confirming = null;
  });

  let isFullThread = $derived(selectedUuid === FULL_THREAD_UUID);
  let statsByUuid = $derived(new Map(history.entries.map(e => [e.uuid, e])));
  let hasAnyChanges = $derived(history.total.filesChanged > 0);

  function getMessageText(uuid: string): string {
    // Prefer text stored in the checkpoint itself (persisted in git commit message),
    // fall back to in-memory rewind points, then generic label. Older builds
    // stored the sent text, which starts with attached file content; skip that.
    const cp = checkpoints.find(c => c.uuid === uuid);
    if (cp?.text && !/^<(file|folder) path="/.test(cp.text)) return cp.text;
    const point = rewindPoints.find(p => p.uuid === uuid);
    return point?.text ?? `Turn checkpoint`;
  }

  async function handleRewind(mode: 'files' | 'all' | 'conversation') {
    if (!selectedUuid || isFullThread) return;
    confirming = null;
    rewinding = true;
    error = '';
    try {
      if (mode === 'conversation') {
        await messageStore.executeRewind(sessionId, selectedUuid, { conversationOnly: true });
      } else if (mode === 'files') {
        await messageStore.executeRewind(sessionId, selectedUuid, { filesOnly: true });
      } else {
        await messageStore.executeRewind(sessionId, selectedUuid);
      }
      // The selected checkpoint (and any later ones) may now be pruned — drop the
      // stale selection/diff before reloading the list.
      checkpointStore.clearSelection(sessionId);
      checkpointStore.refresh(sessionId);
    } catch (e: any) {
      error = e?.message || 'Rewind failed';
    } finally {
      rewinding = false;
    }
  }

  let selectedCheckpoint = $derived(checkpoints.find(c => c.uuid === selectedUuid));
  /** Checkpoints from before the last /clear: files restorable, conversation gone. */
  let selectedBeforeClear = $derived(!!selectedCheckpoint?.beforeClear);
  /** What the pending rewind discards: files back to before the turn (the
   *  checkpoint is taken before its prompt), and the turns from it on. */
  let confirmText = $derived.by(() => {
    const at = `#${selectedCheckpoint?.turn ?? '?'}`;
    const files = 'every change since is lost, yours included, and new files are deleted';
    if (confirming === 'files') return `Restore files to ${at}? They go back to before this turn, so ${files}.`;
    if (confirming === 'conversation') return `Rewind the thread to ${at}? This turn and later ones leave the thread. Files stay as they are.`;
    return `Rewind to ${at}? Files go back to before this turn, so ${files}. This turn and later ones leave the thread.`;
  });
  /** Index of the first pre-clear entry in the newest-first list (divider position). */
  let firstBeforeClearIdx = $derived(checkpoints.findIndex(c => c.beforeClear));

  function loadDiff(entry: GitStatusEntry) { return checkpointStore.loadFileDiff(sessionId, entry); }
  function loadFileLines(entry: GitStatusEntry) { return checkpointStore.loadFileLines(sessionId, entry); }

  let comparisonLabel = $derived(
    isFullThread ? 'all turns' : `checkpoint #${selectedCheckpoint?.turn ?? '?'}, ${diffMode === 'turn' ? 'this turn' : 'since here'}`,
  );
  // The first load has no file list yet: say so in the diff pane, next to the
  // (empty) file sidebar, rather than swapping the whole layout out.
  let emptyTitle = $derived(
    isDiffLoading && !files
      ? 'Loading diff...'
      : files?.scopeError
        ?? (isFullThread ? 'No file changes in this thread' : diffMode === 'turn' ? 'No file changes in this turn' : 'No file changes since this checkpoint'),
  );
</script>

{#snippet statsBadge(stats: DiffStats | undefined)}
  {#if stats && stats.filesChanged > 0}
    <span class="shrink-0 text-micro tabular-nums flex items-center gap-1 leading-none mt-0.5">
      {#if stats.additions}<span class="text-green-400">+{stats.additions}</span>{/if}
      {#if stats.deletions}<span class="text-red-400">−{stats.deletions}</span>{/if}
    </span>
  {/if}
{/snippet}

{#if isLoading && checkpoints.length === 0}
  <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground text-xs relative overflow-hidden">
    Loading checkpoints...
  </div>
{:else if checkpoints.length === 0}
  <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground text-xs relative overflow-hidden">
    {#if groveAgent}
      <GroveEmptyState variant="agent" agent={groveAgent} tab="checkpoints">
        <p class="font-pixel text-base mt-5 mb-2 text-foreground/90">No checkpoints yet</p>
        <p class="text-xs text-muted-foreground max-w-md">Each message you send saves one before the agent acts on it, so you can see what that turn changed and rewind to it.</p>
      </GroveEmptyState>
    {:else}
      No checkpoints yet — send a message to create one.
    {/if}
  </div>
{:else}
  <div class="flex-1 flex overflow-hidden">
    <!-- Left: Checkpoint list -->
    <div class="{listCollapsed ? 'w-9' : 'w-56'} flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden">
      {#if listCollapsed}
        <!-- Rail: expand button, All turns, one turn number per checkpoint -->
        <div class="border-b border-border py-1.5 shrink-0 flex justify-center">
          <PanelToggle panel="checkpointList" label="checkpoint list" />
        </div>
        <button
          onclick={() => checkpointStore.selectFullThread(sessionId)}
          class="w-full h-7 flex items-center justify-center border-b border-border border-l-2 transition-colors
            {isFullThread ? 'bg-sidebar-accent border-l-primary' : 'border-l-transparent hover:bg-accent/30'}"
          title="All turns: everything changed since the thread started"
          aria-label="All turns"
        >
          <svg class="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
        <div class="flex-1 overflow-y-auto">
          {#each checkpoints as cp, i (cp.uuid)}
            {#if i === firstBeforeClearIdx}
              <div class="h-1 bg-muted/60" title="Turns below are from before /clear"></div>
            {/if}
            <button
              onclick={() => checkpointStore.selectCheckpoint(sessionId, cp.uuid)}
              class="w-full h-7 flex items-center justify-center text-micro font-mono border-b border-border/50 border-l-2 transition-colors
                {cp.uuid === selectedUuid ? 'bg-sidebar-accent border-l-primary text-foreground' : 'border-l-transparent hover:bg-accent/30 text-muted-foreground'}
                {cp.beforeClear && cp.uuid !== selectedUuid ? 'opacity-60' : ''}"
              title="#{cp.turn}: {getMessageText(cp.uuid)}"
              data-turn={cp.turn}
            >
              {cp.turn}
            </button>
          {/each}
        </div>
      {:else}
        <div class="border-b border-border pl-3 pr-1.5 py-1.5 shrink-0 flex items-center justify-between">
          <span class="text-xs text-muted-foreground">{checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}</span>
          <PanelToggle panel="checkpointList" label="checkpoint list" />
        </div>

        <!-- Full-thread cumulative diff entry -->
        <button
          onclick={() => checkpointStore.selectFullThread(sessionId)}
          class="w-full flex items-start gap-2 px-3 py-2 text-left text-xs border-b border-border transition-colors
            {isFullThread ? 'bg-sidebar-accent border-l-2 border-l-primary' : 'hover:bg-accent/30'}"
          title="Cumulative diff of everything changed since the thread started"
        >
          <svg class="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          <span class="flex-1 min-w-0 truncate text-foreground/80 leading-tight font-medium">All turns</span>
          {#if hasAnyChanges}
            {@render statsBadge(history.total)}
          {/if}
        </button>

        <div class="flex-1 overflow-y-auto">
          {#each checkpoints as cp, i (cp.uuid)}
            {@const isSelected = cp.uuid === selectedUuid}
            {@const text = getMessageText(cp.uuid)}
            {@const stats = statsByUuid.get(cp.uuid)}
            {#if i === firstBeforeClearIdx}
              <SectionLabel
                class="px-3 py-1 bg-muted/30 border-b border-border/50"
                title="Turns from a thread that was cleared with /clear. Their files can still be restored."
              >
                Before /clear
              </SectionLabel>
            {/if}
            <button
              onclick={() => checkpointStore.selectCheckpoint(sessionId, cp.uuid)}
              class="w-full flex items-start gap-2 px-3 py-2 text-left text-xs border-b border-border/50 transition-colors
                {isSelected ? 'bg-sidebar-accent border-l-2 border-l-primary' : 'hover:bg-accent/30'}"
            >
              <Badge variant="solid" tone="muted" class="font-mono mt-0.5">#{cp.turn}</Badge>
              <span class="flex-1 min-w-0 truncate leading-tight {cp.beforeClear ? 'text-muted-foreground' : 'text-foreground/80'}">
                {text.length > 80 ? text.slice(0, 80) + '...' : text}
              </span>
              {@render statsBadge(stats)}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Right: Detail pane -->
    <div class="pixel-bg flex-1 flex flex-col overflow-hidden relative">
      {#if !selectedUuid}
        <div class="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          {#if groveAgent}
            <GroveEmptyState variant="agent" agent={groveAgent} tab="checkpoints">
              <p class="font-pixel text-base mt-5 mb-2 text-foreground/90">Select a checkpoint to view changes</p>
              <p class="text-xs text-muted-foreground max-w-md">Pick a turn on the left to see what it changed, or All turns for the whole thread.</p>
            </GroveEmptyState>
          {:else}
            Select a checkpoint to view changes
          {/if}
        </div>
      {:else}
        <!-- Header -->
        <PanelHeader>
          {#if isFullThread}
            <span class="text-xs text-foreground truncate font-medium">Full thread diff</span>
            {#if hasAnyChanges}
              <span class="text-micro text-muted-foreground shrink-0">
                {history.total.filesChanged} file{history.total.filesChanged !== 1 ? 's' : ''}
              </span>
              {@render statsBadge(history.total)}
            {/if}
          {:else}
            <Badge variant="solid" tone="muted" class="font-mono">#{selectedCheckpoint?.turn}</Badge>
            <span class="text-xs text-foreground truncate">
              {getMessageText(selectedUuid)}
            </span>
          {/if}
          {#snippet actions()}
            {#if !isFullThread}
              <!-- Diff mode toggle -->
              <Segmented.Root
                bind:value={() => diffMode, (v) => checkpointStore.setDiffMode(sessionId, v as CheckpointDiffMode)}
                class="mr-1"
                aria-label="Diff mode"
              >
                <Segmented.Item value="turn" title="Show what this turn changed">This turn</Segmented.Item>
                <Segmented.Item value="since" title="Show everything changed since this checkpoint (what a rewind would undo)">
                  Since here
                </Segmented.Item>
              </Segmented.Root>
              {#if selectedBeforeClear}
                <!-- The conversation this turn belonged to was cleared; only the
                     files can come back. -->
                <Button
                  size="xs"
                  variant="outline-destructive"
                  onclick={() => (confirming = 'files')}
                  disabled={rewinding}
                  title="Restore files to this checkpoint. The thread was cleared, so it is left as is. Asks first."
                >
                  {rewinding ? 'Restoring...' : 'Restore files'}
                </Button>
              {:else}
                <Button
                  size="xs"
                  variant="outline-destructive"
                  onclick={() => (confirming = 'all')}
                  disabled={rewinding}
                  title="Restore files and rewind thread to this point. Asks first."
                >
                  {rewinding ? 'Rewinding...' : 'Rewind all'}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  onclick={() => (confirming = 'conversation')}
                  disabled={rewinding}
                  title="Only rewind thread, keep current files. Asks first."
                >
                  Thread only
                </Button>
              {/if}
            {/if}
          {/snippet}
        </PanelHeader>

        {#if confirming}
          <div class="shrink-0 border-b border-border px-3 py-2 flex flex-wrap items-center gap-2">
            <p class="flex-1 min-w-48 text-xs text-foreground" role="alert">{confirmText}</p>
            <Button variant="subtle" size="xs" onclick={() => (confirming = null)}>Cancel</Button>
            <Button variant="destructive" size="xs" disabled={rewinding} onclick={() => handleRewind(confirming!)}>
              {confirming === 'files' ? 'Restore' : confirming === 'conversation' ? 'Rewind thread' : 'Rewind'}
            </Button>
          </div>
        {/if}

        {#if error}
          <Notice tone="danger" class="shrink-0 border-b border-b-border">
            <p>{error}</p>
          </Notice>
        {/if}

        <!-- Diff content: the shared review panel (file sidebar + diff) -->
        <ReviewDiffPanel
          {sessionId}
          {sourceKey}
          entries={files?.entries ?? []}
          active={sessionStore.activeSessionId === sessionId && messageStore.getActiveTab(sessionId) === 'checkpoints'}
          loading={isDiffLoading}
          changesLabel={isFullThread ? 'Changed this thread' : diffMode === 'turn' ? 'Changed this turn' : 'Changed since checkpoint'}
          {loadDiff}
          {loadFileLines}
          onRefresh={() => checkpointStore.reloadFiles(sessionId)}
          commentContext={comparisonLabel}
          {emptyTitle}
          emptyScene="checkpoints"
          panel="checkpointFiles"
        />
      {/if}
    </div>
  </div>
{/if}
