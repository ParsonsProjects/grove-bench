<script lang="ts">
  /**
   * A status-bar popover: its trigger, and a panel that opens above it. The
   * owner keeps `open` and decides what opening does; this closes it on a
   * click outside and on Escape, and keeps the panel inside the window.
   *
   * Escape is handled in the capture phase and only while the popover is on
   * screen: every conversation's pane stays mounted, and one left open in a
   * hidden pane must not swallow Escape meant for what is on screen. It
   * stops there, so it doesn't reach the prompt (where it stops the agent),
   * and gives focus back to the trigger if focus was inside.
   */
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { keepInViewport } from '../lib/keep-in-viewport.js';

  let {
    open = $bindable(false),
    trigger,
    children,
    align = 'left',
    anchored = true,
    animate = false,
    panelClass = 'bg-popover border border-border shadow-xl p-3 text-xs w-80',
    class: className = '',
    testid,
  }: {
    open?: boolean;
    /** What opens it. Mark the toggle with data-popover-trigger when it isn't
     *  the first button, so Escape hands focus back to the right one. */
    trigger: Snippet;
    children: Snippet;
    /** Which edge of the anchor the panel lines up with. */
    align?: 'left' | 'right';
    /** False when a parent stack is the anchor, so popovers that share it
     *  open above the whole stack rather than over each other. */
    anchored?: boolean;
    /** Slide in (the PR popover and the branch picker do). */
    animate?: boolean;
    /** The panel's look; replaces the default box. */
    panelClass?: string;
    class?: string;
    testid?: string;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // isConnected: a click that swaps its own button out of the panel
      // (Enable/Disable, "Start fresh…", a re-keyed row) has left the DOM by
      // the time it bubbles here, and must not read as a click outside.
      if (root && target.isConnected && !root.contains(target)) open = false;
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !(root?.checkVisibility?.() ?? true)) return;
      e.stopPropagation();
      // Escape pressed while typing elsewhere shouldn't move the caret.
      const focusWasInside = !!root?.contains(document.activeElement);
      open = false;
      if (focusWasInside) {
        (root?.querySelector<HTMLElement>('[data-popover-trigger]') ?? root?.querySelector<HTMLElement>('button'))?.focus();
      }
    };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeydown, true);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeydown, true);
    };
  });

  // whitespace-normal: a panel inside a no-wrap row must still wrap its text.
  let placement = $derived(`absolute bottom-full mb-2 z-50 whitespace-normal ${align === 'right' ? 'right-0' : 'left-0'}`);
</script>

<div bind:this={root} class="{anchored ? 'relative' : ''} {className}">
  {@render trigger()}
  {#if open}
    {#if animate}
      <div transition:fly={{ y: 6, duration: 140 }} use:keepInViewport class="{placement} {panelClass}" data-testid={testid}>
        {@render children()}
      </div>
    {:else}
      <div use:keepInViewport class="{placement} {panelClass}" data-testid={testid}>
        {@render children()}
      </div>
    {/if}
  {/if}
</div>
