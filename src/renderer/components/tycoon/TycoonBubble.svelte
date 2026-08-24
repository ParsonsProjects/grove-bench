<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    /** The workspace panes. Always rendered (hidden via CSS when closed) so
     *  per-session subscriptions and terminal state survive bubble closes. */
    children: Snippet;
  }

  let { open, title, onclose, children }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="absolute inset-0 z-20 flex flex-col items-center" class:hidden={!open}>
  <!-- Dimmed office behind the bubble; click to close -->
  <div
    class="absolute inset-0 bg-black/50"
    onclick={onclose}
    role="presentation"
  ></div>

  <!-- Giant speech bubble -->
  <div class="bubble relative flex flex-col min-h-0 bg-background">
    <div class="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
      <span class="text-xs text-muted-foreground truncate" {title}>{title}</span>
      <button
        type="button"
        onclick={onclose}
        class="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title="Back to the office (Esc)"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
    </div>
    <div class="flex-1 min-h-0">
      {@render children()}
    </div>

    <!-- Pixel-stepped tail pointing down at the office -->
    <div class="tail" aria-hidden="true">
      <span class="t t1"></span>
      <span class="t t2"></span>
      <span class="t t3"></span>
    </div>
  </div>
</div>

<style>
  .bubble {
    margin-top: 1.25rem;
    width: min(96%, 90rem);
    height: calc(100% - 4.5rem);
    border: 3px solid #e8e8e2;
    /* Pixel corners: notch each corner with hard shadows */
    box-shadow:
      0 0 0 3px oklch(0 0 0 / 0.35),
      0 10px 30px oklch(0 0 0 / 0.5);
  }

  .tail {
    position: absolute;
    bottom: -1.9rem;
    left: 3.5rem;
    width: 2.5rem;
    height: 1.9rem;
  }
  .t {
    position: absolute;
    left: 0;
    background: #e8e8e2;
  }
  .t1 { top: 0; width: 1.9rem; height: 0.65rem; }
  .t2 { top: 0.65rem; width: 1.2rem; height: 0.65rem; }
  .t3 { top: 1.3rem; width: 0.55rem; height: 0.6rem; }
</style>
