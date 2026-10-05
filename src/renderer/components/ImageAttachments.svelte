<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { attachmentImageUrl } from '../../shared/attachments.js';
  import type { ThreadImage } from '../stores/messages.svelte.js';

  let {
    sessionId,
    images,
    class: className = '',
  }: {
    sessionId: string;
    images: ThreadImage[];
    class?: string;
  } = $props();

  /** Images that failed to load (the file is gone), by src. */
  let failed = $state<Record<string, true>>({});
  let openIndex = $state<number | null>(null);

  /** Inline data while the app still has it (just sent), otherwise the saved file. */
  function srcOf(img: ThreadImage): string {
    return 'dataUrl' in img ? img.dataUrl : attachmentImageUrl(sessionId, img.file);
  }

  function labelOf(img: ThreadImage): string {
    return img.name || 'Image';
  }

  let openImage = $derived(openIndex !== null ? images[openIndex] : undefined);
</script>

<div class="flex flex-wrap gap-2 {className}">
  {#each images as img, i (i)}
    {@const src = srcOf(img)}
    {#if failed[src]}
      <div
        class="h-16 w-24 flex items-center justify-center px-1 text-center text-[10px] text-muted-foreground border border-border/60"
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

<Dialog.Root open={openImage !== undefined} onOpenChange={(open) => { if (!open) openIndex = null; }}>
  <Dialog.Content class="w-auto max-w-[90vw] sm:max-w-[90vw] p-3 gap-2">
    {#if openImage}
      <Dialog.Title class="text-xs font-normal text-muted-foreground truncate pr-8">{labelOf(openImage)}</Dialog.Title>
      <img
        src={srcOf(openImage)}
        alt={labelOf(openImage)}
        class="max-w-full max-h-[80vh] object-contain mx-auto
          bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:16px_16px]"
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
