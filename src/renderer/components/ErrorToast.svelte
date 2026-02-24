<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';

  // Auto-dismiss after 5 seconds
  $effect(() => {
    if (store.error) {
      const timer = setTimeout(() => store.clearError(), 5000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if store.error}
  <div class="fixed bottom-4 right-4 z-50 max-w-md animate-in">
    <div class="bg-red-900/90 border border-red-700 rounded-lg p-4 shadow-xl backdrop-blur-sm">
      <div class="flex items-start gap-3">
        <span class="text-red-400 shrink-0 mt-0.5">!</span>
        <p class="text-sm text-red-200 flex-1">{store.error}</p>
        <button
          onclick={() => store.clearError()}
          class="text-red-400 hover:text-red-300 shrink-0"
        >
          &times;
        </button>
      </div>
    </div>
  </div>
{/if}
