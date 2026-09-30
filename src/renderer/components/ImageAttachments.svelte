<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
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

  /** Stored images loaded from the attachments folder, by file. null: it's gone. */
  let loaded = $state<Record<string, string | null>>({});
  let openIndex = $state<number | null>(null);

  $effect(() => {
    const sid = sessionId;
    const files = images.flatMap((img) => ('file' in img ? [img.file] : []));
    let stale = false;
    for (const file of files) {
      window.groveBench
        .getAttachmentImage(sid, file)
        .catch(() => null)
        .then((url) => { if (!stale) loaded[file] = url ?? null; });
    }
    return () => { stale = true; };
  });

  /** The image's src: a data URL, null when it's gone, undefined while loading. */
  function srcOf(img: ThreadImage): string | null | undefined {
    return 'dataUrl' in img ? img.dataUrl : loaded[img.file];
  }

  function labelOf(img: ThreadImage): string {
    return img.name || 'Image';
  }

  let openImage = $derived(openIndex !== null ? images[openIndex] : undefined);
  let openSrc = $derived(openImage ? srcOf(openImage) : undefined);
</script>

<div class="flex flex-wrap gap-2 {className}">
  {#each images as img, i (i)}
    {@const src = srcOf(img)}
    {#if src}
      <button
        type="button"
        onclick={() => (openIndex = i)}
        class="block border border-border/60 hover:border-primary/60 transition-colors
          bg-[repeating-conic-gradient(#222_0_25%,#1a1a1a_0_50%)] bg-[length:16px_16px]"
        title={labelOf(img)}
        aria-label="View {labelOf(img)}"
      >
        <img {src} alt={labelOf(img)} class="block max-h-32 max-w-60 object-contain" />
      </button>
    {:else}
      <div
        class="h-16 w-24 flex items-center justify-center px-1 text-center text-[10px] text-muted-foreground border border-border/60"
        title={labelOf(img)}
      >
        {src === null ? 'Image not available' : 'Loading…'}
      </div>
    {/if}
  {/each}
</div>

<Dialog.Root open={openIndex !== null} onOpenChange={(open) => { if (!open) openIndex = null; }}>
  <Dialog.Content class="w-auto max-w-[90vw] sm:max-w-[90vw] p-3 gap-2">
    {#if openImage && openSrc}
      <Dialog.Title class="text-xs font-normal text-muted-foreground truncate pr-8">{labelOf(openImage)}</Dialog.Title>
      <img
        src={openSrc}
        alt={labelOf(openImage)}
        class="max-w-full max-h-[80vh] object-contain mx-auto
          bg-[repeating-conic-gradient(#222_0_25%,#1a1a1a_0_50%)] bg-[length:16px_16px]"
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
