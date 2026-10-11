<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { gitReady } from '../../shared/prerequisites.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  // Shown at the top of the Changes tab, and (boxed) on the first screen and
  // in a new conversation, so a missing git is known before the first
  // message. Git only gates git-backed features, so it is a warning rather
  // than a blocker.
  let { boxed = false }: { boxed?: boolean } = $props();

  const git = $derived(store.prerequisites?.git);
  const visible = $derived(!!store.prerequisites && !gitReady(store.prerequisites));
</script>

{#if visible && git}
  <!-- Boxed: a notice on its own. Otherwise a strip across the top of the
       Changes tab, ruled off from the panel below. -->
  <Notice tone="warning" class="items-center {boxed ? '' : 'shrink-0 border-b border-b-border'}">
    {#snippet actions()}
      <Button size="2xs" variant="subtle" onclick={() => window.groveBench.openExternal('https://git-scm.com/downloads')}>
        Download Git
      </Button>
      <Button size="2xs" variant="subtle" disabled={prerequisitesStore.checking} onclick={() => prerequisitesStore.refresh()}>
        {prerequisitesStore.checking ? 'Checking…' : 'Re-check'}
      </Button>
    {/snippet}
    <p>
      {#if git.available}
        Git is too old ({git.version}). Separate copies, branches and rewinding need Git 2.17 or later.
      {:else}
        Git isn't installed. Without it, the agent edits your project folder in place and its edits can't be
        rewound.
      {/if}
    </p>
  </Notice>
{/if}
