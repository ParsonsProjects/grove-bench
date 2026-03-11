<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  $effect(() => {
    if (store.error) {
      const timer = setTimeout(() => store.clearError(), 5000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if store.error}
  <div class="fixed bottom-4 right-4 z-50 max-w-md animate-in">
    <div class="bg-destructive/90 border border-destructive p-4 shadow-xl backdrop-blur-sm">
      <div class="flex items-start gap-3">
        <span class="text-white/80 shrink-0 mt-0.5">!</span>
        <p class="text-sm text-white flex-1">{store.error}</p>
        <button
          onclick={() => store.clearError()}
          class="text-white/80 hover:text-white shrink-0"
        >
          &times;
        </button>
      </div>
    </div>
  </div>
{/if}
