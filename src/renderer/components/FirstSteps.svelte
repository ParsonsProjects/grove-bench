<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { addProject } from '../lib/add-project.js';
  import { gitReady } from '../../shared/prerequisites.js';
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
  {#if store.prerequisites && !gitReady(store.prerequisites)}
    <p class="text-xs text-yellow-500 max-w-sm mt-2">
      Git isn't set up on this computer, so the agent will edit your project folder directly and its edits can't be
      rewound.
    </p>
  {/if}
  <Button class="mt-4" size="sm" onclick={addProject}>Add a project</Button>
{:else}
  <p class="text-sm mb-2 text-foreground/80">No conversations yet</p>
  <p class="text-xs text-muted-foreground max-w-sm">Start a conversation and tell the agent what to work on.</p>
  <Button class="mt-4" size="sm" onclick={() => draftStore.open()}>Start a conversation</Button>
{/if}
