<script lang="ts">
  import { checkpointStore, FULL_THREAD_UUID } from '../stores/checkpoints.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import DiffView, { type DiffLine } from './DiffView.svelte';
  import type { DiffStats } from '../../shared/types.js';

  let { sessionId }: { sessionId: string } = $props();

  let checkpoints = $derived(checkpointStore.getCheckpoints(sessionId));
  let isLoading = $derived(checkpointStore.isLoading(sessionId));
  let selectedUuid = $derived(checkpointStore.getSelected(sessionId));
  let diff = $derived(checkpointStore.getDiff(sessionId));
  let isDiffLoading = $derived(checkpointStore.isDiffLoading(sessionId));
  let rewindPoints = $derived(messageStore.getRewindPoints(sessionId));
  let history = $derived(checkpointStore.getHistory(sessionId));
  let diffMode = $derived(checkpointStore.getDiffMode(sessionId));
  let rewinding = $state(false);
  let error = $state('');

  let isFullThread = $derived(selectedUuid === FULL_THREAD_UUID);
  let statsByUuid = $derived(new Map(history.entries.map(e => [e.uuid, e])));
  let hasAnyChanges = $derived(history.total.filesChanged > 0);

  function getMessageText(uuid: string): string {
    // Prefer text stored in the checkpoint itself (persisted in git commit message),
    // fall back to in-memory rewind points, then generic label
    const cp = checkpoints.find(c => c.uuid === uuid);
    if (cp?.text) return cp.text;
    const point = rewindPoints.find(p => p.uuid === uuid);
    return point?.text ?? `Turn checkpoint`;
  }

  function parseDiffLines(raw: string): DiffLine[] {
    if (!raw || raw === '(no changes)') return [];
    return raw.split('\n').map(line => {
      if (line.startsWith('@@')) return { type: 'hunk' as const, text: line };
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff '))
        return { type: 'header' as const, text: line };
      if (line.startsWith('+')) return { type: 'add' as const, text: line };
      if (line.startsWith('-')) return { type: 'del' as const, text: line };
      return { type: 'context' as const, text: line };
    });
  }

  async function handleRewind(mode: 'files' | 'all' | 'conversation') {
    if (!selectedUuid || isFullThread) return;
    rewinding = true;
    error = '';
    try {
      if (mode === 'conversation') {
        await messageStore.executeRewind(sessionId, selectedUuid, { conversationOnly: true });
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
</script>

{#snippet statsBadge(stats: DiffStats | undefined)}
  {#if stats && stats.filesChanged > 0}
    <span class="shrink-0 text-[10px] tabular-nums flex items-center gap-1 leading-none mt-0.5">
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
    No checkpoints yet — send a message to create one.
  </div>
{:else}
  <div class="flex-1 flex overflow-hidden">
    <!-- Left: Checkpoint list -->
    <div class="w-56 flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden">
      <div class="border-b border-border px-3 py-2 shrink-0">
        <span class="text-xs text-muted-foreground">{checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}</span>
      </div>

      <!-- Full-thread cumulative diff entry -->
      <button
        onclick={() => checkpointStore.selectFullThread(sessionId)}
        class="w-full flex items-start gap-2 px-3 py-2 text-left text-xs border-b border-border transition-colors
          {isFullThread ? 'bg-sidebar-accent border-l-2 border-l-primary' : 'hover:bg-accent/30'}"
        title="Cumulative diff of everything changed since the session started"
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
        {#each checkpoints as cp (cp.uuid)}
          {@const isSelected = cp.uuid === selectedUuid}
          {@const text = getMessageText(cp.uuid)}
          {@const stats = statsByUuid.get(cp.uuid)}
          <button
            onclick={() => checkpointStore.selectCheckpoint(sessionId, cp.uuid)}
            class="w-full flex items-start gap-2 px-3 py-2 text-left text-xs border-b border-border/50 transition-colors
              {isSelected ? 'bg-sidebar-accent border-l-2 border-l-primary' : 'hover:bg-accent/30'}"
          >
            <span class="shrink-0 bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-mono leading-none mt-0.5">
              #{cp.turn}
            </span>
            <span class="flex-1 min-w-0 truncate text-foreground/80 leading-tight">
              {text.length > 80 ? text.slice(0, 80) + '...' : text}
            </span>
            {@render statsBadge(stats)}
          </button>
        {/each}
      </div>
    </div>

    <!-- Right: Detail pane -->
    <div class="pixel-bg flex-1 flex flex-col overflow-hidden relative">
      {#if !selectedUuid}
        <div class="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          Select a checkpoint to view changes
        </div>
      {:else}
        <!-- Header -->
        <div class="border-b border-border px-4 py-2 shrink-0 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            {#if isFullThread}
              <span class="text-xs text-foreground truncate font-medium">Full thread diff</span>
              {#if hasAnyChanges}
                <span class="text-[10px] text-muted-foreground shrink-0">
                  {history.total.filesChanged} file{history.total.filesChanged !== 1 ? 's' : ''}
                </span>
                {@render statsBadge(history.total)}
              {/if}
            {:else}
              <span class="bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-mono leading-none shrink-0">
                #{selectedCheckpoint?.turn}
              </span>
              <span class="text-xs text-foreground truncate">
                {getMessageText(selectedUuid)}
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            {#if !isFullThread}
              <!-- Diff mode toggle -->
              <div class="flex items-center border border-border mr-1" role="group" aria-label="Diff mode">
                <button
                  onclick={() => checkpointStore.setDiffMode(sessionId, 'turn')}
                  class="px-2 py-1 text-[10px] transition-colors {diffMode === 'turn' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
                  title="Show what this turn changed"
                >
                  This turn
                </button>
                <button
                  onclick={() => checkpointStore.setDiffMode(sessionId, 'since')}
                  class="px-2 py-1 text-[10px] transition-colors {diffMode === 'since' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
                  title="Show everything changed since this checkpoint (what a rewind would undo)"
                >
                  Since here
                </button>
              </div>
              <button
                onclick={() => handleRewind('all')}
                disabled={rewinding}
                class="px-2 py-1 text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                title="Restore files and rewind conversation to this point"
              >
                {rewinding ? 'Rewinding...' : 'Rewind all'}
              </button>
              <button
                onclick={() => handleRewind('conversation')}
                disabled={rewinding}
                class="px-2 py-1 text-[10px] bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                title="Only rewind conversation, keep current files"
              >
                Conv. only
              </button>
            {/if}
          </div>
        </div>

        {#if error}
          <div class="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
            {error}
          </div>
        {/if}

        <!-- Diff content -->
        <div class="flex-1 flex flex-col overflow-y-auto">
          {#if isDiffLoading}
            <div class="flex-1 flex items-center justify-center text-muted-foreground text-xs">
              Loading diff...
            </div>
          {:else if diff && diff !== '(no changes)' && !diff.startsWith('No checkpoint')}
            <DiffView lines={parseDiffLines(diff)} />
          {:else}
            <div class="flex-1 flex items-center justify-center text-muted-foreground text-xs">
              {#if diff?.startsWith('No checkpoint')}
                {diff}
              {:else if isFullThread}
                No file changes in this session
              {:else if diffMode === 'turn'}
                No file changes in this turn
              {:else}
                No file changes since this checkpoint
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
