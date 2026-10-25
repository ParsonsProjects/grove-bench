<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { reportCaught, reportFromError } from '../lib/error-handling.js';

  /** A workspace tab whose code loads on its first visit (lazyComponent).
   *  If that fails, the tab says so rather than staying blank. Nothing in
   *  the page can try again (Chromium keeps a failed import), so it says to
   *  restart. */
  let { load, tab, children }: {
    load: () => Promise<T>;
    /** The tab's name, as its button shows it. */
    tab: string;
    children: Snippet<[T]>;
  } = $props();

  let loaded = $state<{ component: T } | null>(null);
  let failure = $state<string | null>(null);

  // Started here rather than in a derived: loading the code is a side effect.
  $effect(() => {
    load().then(
      (component) => { loaded = { component }; },
      (error: unknown) => {
        failure = reportFromError('lazy-load', error).message;
        // Logged and reported as before, toast included.
        reportCaught(error);
      },
    );
  });
</script>

{#if loaded}
  {@render children(loaded.component)}
{:else if failure !== null}
  <Notice tone="danger" class="m-3">
    <p>Couldn't load the {tab} tab ({failure}). Restart Grove Bench to try again; if that doesn't help, reinstall it.</p>
  </Notice>
{/if}
