<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  $effect(() => {
    if (store.error) {
      const timer = setTimeout(() => store.clearError(), 5000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if store.error}
  <div class="fixed bottom-4 right-4 z-50 max-w-md animate-in">
    <div class="bg-popover border border-border shadow-xl">
      <Notice tone="danger">
        {#snippet actions()}
          <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => store.clearError()}>
            <XIcon />
          </Button>
        {/snippet}
        <p>{store.error}</p>
      </Notice>
    </div>
  </div>
{/if}
