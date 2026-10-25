<script lang="ts">
  import { fly } from 'svelte/transition';
  import { memoryStore } from '../stores/memory.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  // Auto-dismiss; errors linger longer so they aren't missed
  $effect(() => {
    if (memoryStore.toast) {
      const timer = setTimeout(
        () => (memoryStore.toast = null),
        memoryStore.toast.kind === 'error' ? 10_000 : 6_000,
      );
      return () => clearTimeout(timer);
    }
  });

  function openPanel() {
    memoryStore.panelOpen = true;
    memoryStore.toast = null;
  }
</script>

{#if memoryStore.toast}
  {@const toast = memoryStore.toast}
  <!-- Placed by the toast stack in App.svelte. -->
  <div transition:fly={{ y: 8, duration: 140 }}>
    <div class="bg-popover border border-border shadow-xl">
      <Notice tone={toast.kind === 'error' ? 'danger' : toast.kind === 'success' ? 'success' : 'info'}>
        {#snippet actions()}
          {#if toast.showView}
            <Button size="2xs" variant="link" onclick={openPanel}>View</Button>
          {/if}
          <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => (memoryStore.toast = null)}>
            <XIcon />
          </Button>
        {/snippet}
        <p>{toast.message}</p>
      </Notice>
    </div>
  </div>
{/if}
