<script lang="ts">
  /**
   * A kind of step as a 12px pixel icon (lib/step-icons.ts), in the text's
   * colour unless `class` sets one. Decorative: what it stands for is in the
   * text or tooltip beside it.
   */
  import { cn } from '$lib/utils.js';
  import { stepIconRuns, type StepIconKind } from '$lib/step-icons.js';

  let { kind, class: className = '' }: { kind: StepIconKind; class?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="12"
  height="12"
  viewBox="0 0 12 12"
  fill="currentColor"
  shape-rendering="crispEdges"
  class={cn('shrink-0', className)}
  aria-hidden="true"
>
  {#each stepIconRuns(kind) as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height="1" />{/each}
</svg>
