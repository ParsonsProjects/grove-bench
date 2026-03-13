<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  async function addRepo() {
    const selected = await window.groveBench.addRepo();
    if (selected) {
      store.addRepo(selected);
      store.clearError();
    }
  }
</script>

<Button
  variant="outline"
  size="sm"
  class="w-full text-muted-foreground"
  onclick={addRepo}
>
  + Add Repository
</Button>
