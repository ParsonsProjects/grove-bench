<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';

  async function addRepo() {
    const selected = await window.groveBench.addRepo();
    if (selected) {
      store.addRepo(selected);
      store.clearError();
    }
  }
</script>

<button
  onclick={addRepo}
  class="w-full px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 rounded text-sm transition-colors border border-neutral-800 text-neutral-400"
>
  + Add Repository
</button>
