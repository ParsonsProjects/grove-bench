<script lang="ts">
  /**
   * A percentage as a row of pixel blocks, to sit with the context grove's
   * pixel art: the context meter and the plan usage bars. Blocks light one
   * after another as it rises; the one the percent is inside shows dimmed.
   * Decorative: callers give the number in text.
   */
  import type { HTMLAttributes } from 'svelte/elements';
  import { meterCells } from '../lib/pixel-meter.js';

  let {
    percent,
    cells,
    fillClass,
    class: className = '',
    ...rest
  }: { percent: number; cells: number; fillClass: string; class?: string } & HTMLAttributes<HTMLDivElement> = $props();

  let blocks = $derived(meterCells(percent, cells));
</script>

<div
  class="grid gap-0.5 {className}"
  style:grid-template-columns="repeat({cells}, minmax(0, 1fr))"
  aria-hidden="true"
  {...rest}
>
  {#each blocks as block, i (i)}
    <!-- The inset top edge is the lighter pixel row the grove's plants have. -->
    <span
      class="block h-full transition-[background-color,opacity] duration-150 motion-reduce:transition-none
        {block === 'empty' ? 'bg-muted' : `${fillClass} shadow-[inset_0_2px_0_rgb(255_255_255/0.22)]`}
        {block === 'part' ? 'opacity-40' : ''}"
      style:transition-delay="{i * 30}ms"
      data-block={block}
    ></span>
  {/each}
</div>
