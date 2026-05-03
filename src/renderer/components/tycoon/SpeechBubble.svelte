<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    visible: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    children?: import('svelte').Snippet;
  }

  let { visible, anchorEl, onClose, children }: Props = $props();

  let bubbleEl = $state<HTMLElement | null>(null);
  let backdropEl = $state<HTMLElement | null>(null);
  let tailX = $state(50);

  function recomputeTail() {
    if (!anchorEl || !bubbleEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const bubbleRect = bubbleEl.getBoundingClientRect();
    if (bubbleRect.width === 0) return;
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const relative = anchorCenter - bubbleRect.left;
    const min = 24;
    const max = bubbleRect.width - 24;
    const clamped = Math.max(min, Math.min(max, relative));
    tailX = (clamped / bubbleRect.width) * 100;
  }

  $effect(() => {
    visible;
    anchorEl;
    if (visible) requestAnimationFrame(recomputeTail);
  });

  onMount(() => {
    const onResize = () => { if (visible) recomputeTail(); };
    window.addEventListener('resize', onResize);

    function onKeydown(e: KeyboardEvent) {
      if (visible && e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeydown);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeydown);
    };
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === backdropEl) {
      onClose();
    }
  }
</script>

<!-- Always mount the wrapper so children stay alive; toggle visibility via class -->
<div
  bind:this={backdropEl}
  class="tycoon-bubble-backdrop"
  class:hidden={!visible}
  onclick={handleBackdropClick}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  role="presentation"
>
  <div bind:this={bubbleEl} class="tycoon-bubble" role="dialog" aria-modal="true">
    <button
      class="tycoon-bubble-close"
      onclick={onClose}
      aria-label="Close"
      title="Close (Esc)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
    <div class="tycoon-bubble-content">
      {@render children?.()}
    </div>
    <div class="tycoon-bubble-tail" style="--tail-x: {tailX}%;"></div>
  </div>
</div>
