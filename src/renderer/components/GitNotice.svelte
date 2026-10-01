<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { gitReady } from '../../shared/prerequisites.js';

  // Shown at the top of the Changes tab, and (boxed) on the first screen and
  // in a new conversation, so a missing git is known before the first
  // message. Git only gates git-backed features, so it is a warning rather
  // than a blocker.
  let { boxed = false }: { boxed?: boolean } = $props();

  const git = $derived(store.prerequisites?.git);
  const visible = $derived(!!store.prerequisites && !gitReady(store.prerequisites));
</script>

{#if visible && git}
  <div
    class="flex items-center gap-3 text-xs bg-yellow-500/10 {boxed
      ? 'flex-wrap px-3 py-2 border border-yellow-500/40'
      : 'px-3 py-1.5 border-b border-border'}"
    role="status"
  >
    <span class="text-yellow-500 shrink-0">!</span>
    <span class="flex-1 min-w-0 text-foreground/80">
      {#if git.available}
        Git is too old ({git.version}). Separate copies, branches and rewinding need Git 2.17 or later.
      {:else}
        Git isn't installed. Without it, the agent edits your project folder in place and its edits can't be
        rewound.
      {/if}
    </span>
    <span class="flex items-center gap-3 shrink-0 {boxed ? 'ml-auto' : ''}">
      <button
        type="button"
        class="text-primary hover:underline"
        onclick={() => window.groveBench.openExternal('https://git-scm.com/downloads')}
      >
        Download Git
      </button>
      <button
        type="button"
        class="text-primary hover:underline disabled:opacity-50"
        disabled={prerequisitesStore.checking}
        onclick={() => prerequisitesStore.refresh()}
      >
        {prerequisitesStore.checking ? 'Checking…' : 'Re-check'}
      </button>
    </span>
  </div>
{/if}
