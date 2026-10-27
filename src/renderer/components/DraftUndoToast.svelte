<script lang="ts">
  /**
   * Prototype 'undo' Discard (draft-prototype): after the Discard button
   * drops a draft with a message or files, offers it back for a few seconds.
   */
  import { draftStore } from '../stores/draft.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  $effect(() => {
    if (draftStore.discarded) {
      const timer = setTimeout(() => { draftStore.discarded = null; }, 8000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if draftStore.discarded && !draftStore.draft}
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in" role="status">
    <div class="flex items-center gap-3 bg-popover border border-border shadow-xl pl-3 pr-1.5 py-1.5 text-xs text-foreground">
      <span>Draft discarded.</span>
      <Button size="xs" variant="subtle-primary" onclick={() => draftStore.undoDiscard()}>Undo</Button>
    </div>
  </div>
{/if}
