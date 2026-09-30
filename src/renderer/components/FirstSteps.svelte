<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { addProject } from '../lib/add-project.js';
  import { helpStore } from '../stores/help.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  /**
   * The next step when there are no conversations: add a project first, then
   * start a conversation. A button here, so a first-time user doesn't have
   * to find the matching one at the bottom of the sidebar.
   */
</script>

{#if store.repos.length === 0}
  <p class="text-sm mb-2 text-foreground/80">Add a project to start</p>
  <p class="text-xs text-muted-foreground max-w-sm">
    A project is a folder on this computer, ideally a git repository. With git, each conversation works in its own copy
    (a git worktree), so the agent's changes stay apart from yours until you merge them.
  </p>
  <Button class="mt-4" size="sm" onclick={addProject}>Add a project</Button>
{:else}
  <p class="text-sm mb-2 text-foreground/80">No conversations yet</p>
  <p class="text-xs text-muted-foreground max-w-sm">Start a conversation and tell the agent what to work on.</p>
  <Button class="mt-4" size="sm" onclick={() => draftStore.open()}>Start a conversation</Button>
{/if}
<button type="button" class="mt-3 text-xs text-primary hover:underline" onclick={() => helpStore.show('getting-started')}>
  New here? Read Getting Started (F1)
</button>
