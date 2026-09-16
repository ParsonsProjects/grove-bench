<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';

  /** Icon-only rendering for narrow sidebars; the label moves to the tooltip. */
  let { compact = false }: { compact?: boolean } = $props();

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
  title="Add a repository"
  aria-label="Add a repository"
>
  {#if compact}
    <FolderPlusIcon aria-hidden="true" />
  {:else}
    + Repository
  {/if}
</Button>
