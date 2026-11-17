<script module lang="ts">
  import { lazyComponent } from '$lib/lazy-component.js';

  const loadLightbox = lazyComponent(() => import('./ImageLightbox.svelte'));
</script>

<script lang="ts">
  /**
   * A pane's image lightbox (ImageLightbox), whose code loads the first time
   * an image or its menu opens, and then stays, so it can close as a dialog
   * does and open again at once.
   */
  import type { ThreadImages } from '$lib/thread-images.svelte.js';

  let { images }: { images: ThreadImages } = $props();
</script>

{#if images.used}
  {#await loadLightbox() then ImageLightbox}
    <ImageLightbox {images} />
  {/await}
{/if}
