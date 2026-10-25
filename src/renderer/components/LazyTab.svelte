<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { reportFromError } from '../lib/error-handling.js';

  /** A workspace tab whose code loads on its first visit (lazyComponent).
   *  If that fails, the tab says so, with Retry, rather than staying blank. */
  let { load, tab, sessionId, children }: {
    load: () => Promise<T>;
    /** The tab's name, as its button shows it. */
    tab: string;
    sessionId: string;
    children: Snippet<[T]>;
  } = $props();

  let attempt = $state(0);
  // Asked again on Retry: lazyComponent forgets a load that failed.
  const loading = $derived.by(() => {
    void attempt;
    return load();
  });
  // Logged, as an error nothing handles is, but without its toast: the tab
  // says what went wrong.
  $effect(() => {
    loading.catch((error: unknown) => {
      try { window.groveBench.reportError(reportFromError('lazy-load', error, sessionId)); } catch { /* main may be gone */ }
    });
  });
</script>

{#await loading then loaded}
  {@render children(loaded)}
{:catch error}
  <Notice tone="danger" class="m-3">
    {#snippet actions()}
      <Button size="2xs" variant="link" onclick={() => attempt++}>Retry</Button>
    {/snippet}
    <p>
      Couldn't load the {tab} tab: {error instanceof Error ? error.message : String(error)}. Retry, or restart
      Grove Bench if it keeps failing.
    </p>
  </Notice>
{/await}
