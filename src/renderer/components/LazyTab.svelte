<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
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

  /** How long a tab's code may take before the tab says it's loading. */
  const SLOW_MS = 200;

  let loaded = $state<{ component: T } | null>(null);
  let failure = $state<string | null>(null);
  /** Still loading after SLOW_MS: only then does it say so. Most loads are
   *  in within a frame or two, where a "Loading" would only flash. */
  let slow = $state(false);

  // Started here rather than in a derived: loading the code is a side effect.
  $effect(() => {
    const timer = setTimeout(() => { slow = true; }, SLOW_MS);
    load().finally(() => clearTimeout(timer)).then(
      (component) => { loaded = { component }; },
      (error: unknown) => {
        failure = reportFromError('lazy-load', error).message;
        // Logged and reported as before, toast included.
        reportCaught(error);
      },
    );
    return () => clearTimeout(timer);
  });
</script>


{#if loaded}
  {@render children(loaded.component)}
{:else if failure !== null}
  <Notice tone="danger" class="m-3">
    <p>Couldn't load the {tab} tab ({failure}). Restart Grove Bench to try again; if that doesn't help, reinstall it.</p>
  </Notice>
{:else if slow}
  <div role="status" class="flex-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
    <Pulse size="sm" />
    Loading the {tab} tab…
  </div>
{/if}
