<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { gitReady } from '../../shared/prerequisites.js';

  // Git only gates git-backed features, so a missing or old git gets a
  // dismissible strip instead of blocking the app.
  let dismissed = $state(false);

  const git = $derived(store.prerequisites?.git);
  const visible = $derived(!dismissed && !!store.prerequisites && !gitReady(store.prerequisites));
</script>

{#if visible && git}
  <div class="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-border bg-yellow-500/10" role="status">
    <span class="text-yellow-500 shrink-0">!</span>
    <span class="flex-1 min-w-0 text-foreground/80">
      {#if git.available}
        Git is too old ({git.version}). Projects and branches need Git 2.17 or later.
      {:else}
        Git was not found. Projects and branches need Git 2.17 or later.
      {/if}
    </span>
    <button
      type="button"
      class="text-primary hover:underline shrink-0"
      onclick={() => window.groveBench.openExternal('https://git-scm.com/downloads')}
    >
      Download Git
    </button>
    <button
      type="button"
      class="text-primary hover:underline shrink-0 disabled:opacity-50"
      disabled={prerequisitesStore.checking}
      onclick={() => prerequisitesStore.refresh()}
    >
      {prerequisitesStore.checking ? 'Checking…' : 'Re-check'}
    </button>
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground shrink-0 px-1"
      aria-label="Dismiss"
      onclick={() => (dismissed = true)}
    >
      &#x2715;
    </button>
  </div>
{/if}
