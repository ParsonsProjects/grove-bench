<script lang="ts">
  /**
   * A thread's images at full size in a dialog, over a checkerboard so
   * transparency shows: the arrow keys (and buttons) step through them, and
   * an image can be saved to Downloads or shown in its folder from the
   * buttons or its right-click menu. Also draws that menu for the pane's
   * thumbnails (ImageAttachments), and what a download came to.
   */
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { ThreadImages } from '$lib/thread-images.svelte.js';
  import ContextMenu from './ContextMenu.svelte';
  import Toast from './Toast.svelte';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open';

  let { images }: { images: ThreadImages } = $props();

  let current = $derived(images.current);
  let count = $derived(images.list.length);
  let index = $derived(images.index ?? 0);

  // On the window, not the dialog: a button that turns disabled (Next, at
  // the last image) drops the focus to the page.
  function onkeydown(e: KeyboardEvent) {
    if (!current || e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    images.step(e.key === 'ArrowLeft' ? -1 : 1);
  }
</script>

<svelte:window {onkeydown} />

<Dialog.Root open={current !== undefined} onOpenChange={(open) => { if (!open) images.close(); }}>
  <Dialog.Content class="w-auto max-w-[90vw] sm:max-w-[90vw] p-3 gap-2">
    {#if current}
      {@const shown = current}
      <div class="flex items-center gap-1 min-w-0 pr-8">
        <Dialog.Title class="flex-1 min-w-0 text-xs font-normal text-muted-foreground truncate">{shown.label}</Dialog.Title>
        {#if count > 1}
          <Button size="icon-xs" variant="quiet" aria-label="Previous image" title="Previous image (Left arrow)" disabled={index === 0} onclick={() => images.step(-1)}>
            <ChevronLeftIcon />
          </Button>
          <span class="text-caption text-muted-foreground tabular-nums whitespace-nowrap" data-testid="lightbox-position">{index + 1} of {count}</span>
          <Button size="icon-xs" variant="quiet" aria-label="Next image" title="Next image (Right arrow)" disabled={index === count - 1} onclick={() => images.step(1)}>
            <ChevronRightIcon />
          </Button>
        {/if}
        <Button size="icon-xs" variant="quiet" aria-label="Download" title="Save a copy to Downloads" onclick={() => images.download(shown)}>
          <DownloadIcon />
        </Button>
        <Button size="icon-xs" variant="quiet" aria-label="Open file location" title="Open file location" onclick={() => images.showInFolder(shown)}>
          <FolderOpenIcon />
        </Button>
      </div>
      {#if images.failed[shown.src]}
        <div class="h-40 w-72 max-w-full flex items-center justify-center text-xs text-muted-foreground border border-border/60">
          Image not available
        </div>
      {:else}
        <img
          src={shown.src}
          alt={shown.label}
          oncontextmenu={(e) => images.openMenu(e, shown)}
          onerror={() => (images.failed[shown.src] = true)}
          class="max-w-full max-h-[80vh] object-contain mx-auto
            bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:16px_16px]"
        />
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- Outside the dialog: its content is centred with a transform, which
     would place a fixed menu from the dialog rather than the window.
     Keyed so a right-click while it's open opens it at the new spot. -->
{#key images.menu}
  {#if images.menu}
    {@const image = images.menu.image}
    <ContextMenu
      x={images.menu.x}
      y={images.menu.y}
      label="Image actions"
      items={[
        { label: 'Download', icon: 'export', action: () => void images.download(image) },
        { label: 'Open file location', icon: 'folder', action: () => void images.showInFolder(image) },
      ]}
      onclose={() => (images.menu = null)}
    />
  {/if}
{/key}

{#key images.notice}
  {#if images.notice}
    <Toast tone={images.notice.tone} text={images.notice.text} ondismiss={() => (images.notice = null)} />
  {/if}
{/key}
