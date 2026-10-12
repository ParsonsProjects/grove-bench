<script lang="ts">
  import ImageLightbox from './ImageLightbox.svelte';
  import { attachmentImageUrl } from '../../shared/attachments.js';
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

  /** Images that failed to load (the file is gone), by src. */
  let failed = $state<Record<string, true>>({});
  let openIndex = $state<number | null>(null);

  /** Inline data while the app still has it (just sent), a worktree file's
   *  URL, otherwise the saved file. */
  function srcOf(img: ThreadImage): string {
    if ('dataUrl' in img) return img.dataUrl;
    if ('url' in img) return img.url;
    return attachmentImageUrl(sessionId, img.file);
  }

  function labelOf(img: ThreadImage): string {
    return img.name || 'Image';
  }

  let openImage = $derived(openIndex !== null ? images[openIndex] : undefined);
</script>

<div class="flex flex-wrap gap-2 {className}">
  {#each images as img, i (i)}
    {@const src = srcOf(img)}
    {#if failed[src] && hideUnavailable}
      <!-- Left out. -->
    {:else if failed[src]}
      <div
        class="h-16 w-24 flex items-center justify-center px-1 text-center text-micro text-muted-foreground border border-border/60"
        title={labelOf(img)}
      >
        Image not available
      </div>
    {:else}
      <button
        type="button"
        onclick={() => (openIndex = i)}
        class="block border border-border/60 hover:border-primary/60 transition-colors
          bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:16px_16px]"
        title={labelOf(img)}
        aria-label="View {labelOf(img)}"
      >
        <img
          {src}
          alt={labelOf(img)}
          loading="lazy"
          decoding="async"
          onerror={() => (failed[src] = true)}
          class="block min-h-8 min-w-8 max-h-32 max-w-60 object-contain"
        />
      </button>
    {/if}
  {/each}
</div>

<ImageLightbox
  src={openImage ? srcOf(openImage) : null}
  label={openImage ? labelOf(openImage) : ''}
  onclose={() => (openIndex = null)}
/>
