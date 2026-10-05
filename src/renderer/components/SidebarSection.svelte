<script lang="ts">
  /**
   * One of the sidebar's foldable sections (Groups, Projects): a heading and
   * the list under it. While the section is further down, out of sight, its
   * heading sticks to the bottom of the sidebar, so its name and counts stay
   * in view. Folding the section leaves only the heading; the sidebar's dock
   * spacers put folded sections at the end of the list at its bottom, and one
   * in the middle keeps its place.
   *
   * Renders as direct children of the sidebar's scrolling list: a sticky
   * heading only sticks within its parent, and the list is the parent that
   * spans the whole height.
   */
  import { tick, type Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { panelStore } from '../stores/panels.svelte.js';
  import { prefersReducedMotion } from '$lib/utils.js';
  import AttentionCounts from './AttentionCounts.svelte';
  import type { TriageCounts } from '../lib/session-triage.js';
  import type { CollapsiblePanel } from '../../shared/types.js';

  let {
    panel,
    label,
    count = 0,
    counts,
    below = 0,
    actions,
    children,
  }: {
    /** Where its folded state is saved. */
    panel: CollapsiblePanel;
    label: string;
    /** How many things it lists, shown by the label (0 shows nothing). */
    count?: number;
    /** Attention counts over the whole section, shown while it's folded. */
    counts: TriageCounts;
    /** Section headings after this one. They stick below it, so it sticks
     *  that many headings up from the bottom. */
    below?: number;
    /** Buttons at the heading's right end. */
    actions?: Snippet;
    children: Snippet;
  } = $props();

  /** The heading's height in rem (h-7), which the stacked offsets count in. */
  const HEADING_REM = 1.75;
  /** Same length as the dock spacers' flex-grow transition in Sidebar.svelte,
   *  so a heading moving to or from the dock keeps pace with its list. */
  const SLIDE_MS = 200;

  let collapsed = $derived(panelStore.isCollapsed(panel));
  /** Zero height, just above the heading: where the heading sits when it
   *  isn't stuck. */
  let place = $state<HTMLDivElement>();
  let heading = $state<HTMLDivElement>();
  /** The list opens or closes without sliding (see toggle). */
  let instant = $state(false);

  async function toggle() {
    // Stuck at the bottom, the heading's own place is further down, out of
    // sight: opening it there would add the list where it can't be seen. So
    // the list opens at once and the sidebar scrolls to it.
    const outOfSight = collapsed && heading!.getBoundingClientRect().top < place!.getBoundingClientRect().top - 0.5;
    instant = outOfSight || prefersReducedMotion();
    panelStore.toggle(panel);
    if (!outOfSight) return;
    await tick();
    // The scrolling list (see the comment at the top).
    const list = place!.parentElement!;
    const top = list.scrollTop + place!.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
</script>

<div bind:this={place} class="shrink-0" aria-hidden="true"></div>
<!-- Opaque and full width, so rows scrolling under it don't show through. -->
<div
  bind:this={heading}
  class="sticky z-10 shrink-0 -mx-3 h-7 pl-2 pr-4 flex items-center gap-1 bg-sidebar border-t border-sidebar-border"
  style="bottom: {below * HEADING_REM}rem"
  data-section={panel}
>
  <button
    type="button"
    onclick={toggle}
    aria-expanded={!collapsed}
    class="flex items-center gap-1.5 min-w-0 flex-1 h-full text-left text-muted-foreground hover:text-foreground transition-colors"
    title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 opacity-60 transition-transform" style={collapsed ? 'transform: rotate(-90deg)' : ''} aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    <span class="text-xs uppercase tracking-wide truncate">{label}</span>
    {#if count}
      <span class="text-xs text-muted-foreground/40 shrink-0">{count}</span>
    {/if}
    <!-- Folded, the heading is all there is to see of the section. -->
    {#if collapsed}
      <AttentionCounts {counts} />
    {/if}
  </button>
  {@render actions?.()}
</div>
{#if !collapsed}
  <div class="shrink-0" transition:slide={{ duration: instant ? 0 : SLIDE_MS, easing: cubicOut }}>
    {@render children()}
  </div>
{/if}
