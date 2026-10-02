<script lang="ts">
  /**
   * A status-bar popover: its trigger, and a panel that opens above it. The
   * owner keeps `open` and decides what opening does; this closes it on a
   * click outside and on Escape, and keeps the panel inside the window.
   *
   * Escape closes it while it is on screen (every conversation's pane stays
   * mounted, and one left open in a hidden pane must not react to Escape
   * meant for what is on screen). Only when focus was inside does it keep the
   * key, in the capture phase, and give focus back to the trigger: Escape
   * pressed in a dialog opened over it (Ctrl+,), the conversation finder or
   * the prompt must still reach them.
   *
   * Closes when it unmounts too: a chip that goes away and comes back (the
   * pending tools count, say) must not reopen its popover by itself.
   */
  import { onDestroy, type Snippet } from 'svelte';
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
    label,
    id,
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
    /** Names the panel as a dialog, for screen readers and getByRole. */
    label?: string;
    /** For the trigger's aria-controls. */
    id?: string;
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
      open = false;
      const focused = document.activeElement;
      if (focused && focused !== document.body && !root?.contains(focused)) return;
      e.stopPropagation();
      if (focused && root?.contains(focused)) {
        (root.querySelector<HTMLElement>('[data-popover-trigger]') ?? root.querySelector<HTMLElement>('button'))?.focus();
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
  onDestroy(() => { open = false; });

  let placement = $derived(`absolute bottom-full mb-2 z-50 whitespace-normal ${align === 'right' ? 'right-0' : 'left-0'}`);
</script>

<div bind:this={root} class="{anchored ? 'relative' : ''} {className}">
  {@render trigger()}
  <!-- One block, not an {#if animate} inside {#if open}: a transition is
       local, so it only plays when its own block opens or closes. -->
  {#if open && animate}
    <div transition:fly={{ y: 6, duration: 140 }} use:keepInViewport class="{placement} {panelClass}" data-testid={testid} {id} role={label ? 'dialog' : undefined} aria-label={label}>
      {@render children()}
    </div>
  {:else if open}
    <div use:keepInViewport class="{placement} {panelClass}" data-testid={testid} {id} role={label ? 'dialog' : undefined} aria-label={label}>
      {@render children()}
    </div>
  {/if}
</div>
