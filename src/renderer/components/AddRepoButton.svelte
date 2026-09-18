<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';

  /** Icon-only rendering for narrow sidebars; the label moves to the tooltip. */
  let { compact = false }: { compact?: boolean } = $props();

  async function addProject() {
    const project = await window.groveBench.addProject();
    if (project) {
      store.addProject(project);
      store.clearError();
    }
  }
</script>

<Button
  variant="outline"
  size="sm"
  class="w-full text-muted-foreground"
  onclick={addProject}
  title="Add a project"
  aria-label="Add a project"
>
  {#if compact}
    <FolderPlusIcon aria-hidden="true" />
  {:else}
    + Project
  {/if}
</Button>
