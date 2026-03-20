<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let open = $derived(messageStore.rewindDialogOpen[sessionId] ?? false);
  let rewinding = $state(false);
  let error = $state('');
  let selectedId = $state<string | null>(null);
  let diffPreview = $state<string | null>(null);
  let loadingDiff = $state(false);
  let conversationOnly = $state(false);

  let rewindPoints = $derived(messageStore.getRewindPoints(sessionId));

  function handleOpenChange(value: boolean) {
    if (!value) {
      messageStore.closeRewindDialog(sessionId);
      selectedId = null;
      diffPreview = null;
      conversationOnly = false;
      error = '';
    }
  }

  async function handleSelect(uuid: string) {
    selectedId = uuid;
    diffPreview = null;
    loadingDiff = true;
    try {
      diffPreview = await window.groveBench.getCheckpointDiff(sessionId, uuid);
    } catch (e: any) {
      diffPreview = e?.message || '(Failed to load preview)';
    } finally {
      loadingDiff = false;
    }
  }

  async function handleRewind() {
    if (!selectedId) return;
    rewinding = true;
    error = '';
    try {
      await messageStore.executeRewind(sessionId, selectedId, { conversationOnly });
      messageStore.closeRewindDialog(sessionId);
      selectedId = null;
      diffPreview = null;
      conversationOnly = false;
    } catch (e: any) {
      error = e?.message || 'Rewind failed';
    } finally {
      rewinding = false;
    }
  }

  function truncate(text: string, max = 80): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + '…';
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Rewind to Checkpoint</Dialog.Title>
      <Dialog.Description>
        Select a message to rewind to. Files on disk will be restored to their state at that point.
        <span class="text-muted-foreground text-xs block mt-1">
          Only tracks Write/Edit changes — Bash file modifications are not included.
        </span>
      </Dialog.Description>
    </Dialog.Header>

    {#if rewindPoints.length === 0}
      <div class="py-6 text-center text-muted-foreground text-sm">
        No checkpoints available yet. Send a message to create one.
      </div>
    {:else}
      <div class="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
        {#each rewindPoints as point, i}
          <button
            class="w-full text-left px-3 py-2 rounded-md text-sm transition-colors
              {selectedId === point.uuid
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-muted'}"
            onclick={() => handleSelect(point.uuid)}
          >
            <span class="text-muted-foreground mr-2 font-mono text-xs">
              #{rewindPoints.length - i}
            </span>
            {truncate(point.text)}
          </button>
        {/each}
      </div>

      {#if selectedId && (loadingDiff || diffPreview)}
        <div class="mt-3 border rounded-md p-2 text-xs font-mono bg-muted/50 max-h-32 overflow-y-auto">
          {#if loadingDiff}
            <span class="text-muted-foreground">Loading diff preview…</span>
          {:else if diffPreview}
            <pre class="whitespace-pre-wrap">{diffPreview}</pre>
          {/if}
        </div>
      {/if}
    {/if}

    {#if error}
      <div class="text-destructive text-sm mt-2">{error}</div>
    {/if}

    <div class="flex items-center gap-2 mt-2">
      <Checkbox bind:checked={conversationOnly} id="conversation-only" />
      <label for="conversation-only" class="text-sm text-muted-foreground cursor-pointer select-none">
        Conversation only (keep file changes on disk)
      </label>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => handleOpenChange(false)}>
        Cancel
      </Button>
      <Button
        variant="destructive"
        disabled={!selectedId || rewinding}
        onclick={handleRewind}
      >
        {rewinding ? 'Rewinding…' : 'Rewind'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
