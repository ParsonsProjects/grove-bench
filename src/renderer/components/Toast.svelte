<script lang="ts">
  /**
   * A message in the window's bottom-right corner that goes after a few
   * seconds, or on its ✕: an error (ErrorToast), or what saving an image
   * came to (ImageLightbox). It sits above dialogs and keeps its
   * pointerdowns from them, as ContextMenu does, so dismissing it never
   * closes one. Key it by the message to give a repeat the full time.
   */
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  let {
    text,
    tone = 'info',
    ondismiss,
    timeout = 5000,
  }: {
    text: string;
    tone?: 'info' | 'danger';
    ondismiss: () => void;
    timeout?: number;
  } = $props();

  $effect(() => {
    const timer = setTimeout(() => ondismiss(), timeout);
    return () => clearTimeout(timer);
  });
</script>

<div
  class="fixed bottom-4 right-4 z-[100] pointer-events-auto max-w-md animate-in"
  role="presentation"
  onpointerdown={(e) => e.stopPropagation()}
  onmousedown={(e) => e.preventDefault()}
>
  <div class="bg-popover border border-border shadow-xl">
    <Notice {tone}>
      {#snippet actions()}
        <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => ondismiss()}>
          <XIcon />
        </Button>
      {/snippet}
      <p>{text}</p>
    </Notice>
  </div>
</div>
