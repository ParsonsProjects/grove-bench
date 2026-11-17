<script lang="ts">
  import LazyImageLightbox from './LazyImageLightbox.svelte';
  import { ThreadImages, imageLabel, imageSrc, shownImage, threadImages } from '$lib/thread-images.svelte.js';
  import type { ThreadImage } from '../stores/messages.svelte.js';

  let {
    sessionId,
    images,
    hideUnavailable = false,
    class: className = '',
  }: {
    sessionId: string;
    images: ThreadImage[];
    /** Leave out an image that won't load, instead of saying it's not
     *  available: for a preview that may not apply (the file is gone, or
     *  outside the worktree). */
    hideUnavailable?: boolean;
    class?: string;
  } = $props();

  // The pane's lightbox, which steps through every image in the pane. Out
  // of one (no pane provides it), a lightbox of its own for these.
  const paneImages = threadImages();
  const viewer = paneImages ?? new ThreadImages();

  /** Images that failed to load (the file is gone), by src. */
  let failed = $state<Record<string, true>>({});
  let row = $state<HTMLElement>();

  /** The images here that can be opened, in order. */
  let openable = $derived(images.filter((img) => !failed[imageSrc(sessionId, img)]).map((img) => shownImage(sessionId, img)));

  $effect(() => {
    if (!row) return;
    return viewer.register(row, () => openable);
  });

  function open(img: ThreadImage) {
    if (row) viewer.open(row, openable.findIndex((s) => s.image === img));
  }
</script>

<div bind:this={row} class="flex flex-wrap gap-2 {className}">
  {#each images as img, i (i)}
    {@const src = imageSrc(sessionId, img)}
    {#if failed[src] && hideUnavailable}
      <!-- Left out. -->
    {:else if failed[src]}
      <div
        class="h-16 w-24 flex items-center justify-center px-1 text-center text-micro text-muted-foreground border border-border/60"
        title={imageLabel(img)}
      >
        Image not available
      </div>
    {:else}
      <button
        type="button"
        onclick={() => open(img)}
        oncontextmenu={(e) => viewer.openMenu(e, shownImage(sessionId, img))}
        data-own-menu
        class="block border border-border/60 hover:border-primary/60 transition-colors
          bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:16px_16px]"
        title={imageLabel(img)}
        aria-label="View {imageLabel(img)}"
      >
        <img
          {src}
          alt={imageLabel(img)}
          loading="lazy"
          decoding="async"
          onerror={() => (failed[src] = true)}
          class="block min-h-8 min-w-8 max-h-32 max-w-60 object-contain"
        />
      </button>
    {/if}
  {/each}
</div>

{#if !paneImages}
  <LazyImageLightbox images={viewer} />
{/if}
