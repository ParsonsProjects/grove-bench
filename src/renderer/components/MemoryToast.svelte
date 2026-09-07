<script lang="ts">
  import { fly } from 'svelte/transition';
  import { memoryStore } from '../stores/memory.svelte.js';

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
  <div class="fixed bottom-16 right-4 z-50 max-w-md" transition:fly={{ y: 8, duration: 140 }}>
    <div
      class="border p-3 shadow-xl backdrop-blur-sm flex items-start gap-3
        {toast.kind === 'error' ? 'bg-destructive/90 border-destructive'
          : toast.kind === 'success' ? 'bg-popover border-primary/50'
          : 'bg-popover border-border'}"
    >
      <span class="shrink-0 mt-0.5
        {toast.kind === 'error' ? 'text-white/80'
          : toast.kind === 'success' ? 'text-primary'
          : 'text-muted-foreground'}"
      >
        {toast.kind === 'error' ? '!' : toast.kind === 'success' ? '✓' : 'i'}
      </span>
      <p class="text-sm flex-1 {toast.kind === 'error' ? 'text-white' : 'text-foreground'}">
        {toast.message}
      </p>
      {#if toast.showView}
        <button
          onclick={openPanel}
          class="text-sm shrink-0 underline-offset-2 hover:underline
            {toast.kind === 'error' ? 'text-white' : 'text-primary'}"
        >
          View
        </button>
      {/if}
      <button
        onclick={() => (memoryStore.toast = null)}
        class="shrink-0 {toast.kind === 'error' ? 'text-white/80 hover:text-white' : 'text-muted-foreground hover:text-foreground'}"
      >
        &times;
      </button>
    </div>
  </div>
{/if}
