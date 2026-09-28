<script lang="ts">
  import { GROVE_W, GROVE_H, GROVE_SCALE, groveLayout, groveRuns, grovePaths } from '../lib/context-grove.js';

  /**
   * A strip of grove along the top of the status bar that fills in as the
   * conversation uses its context window. `seed` (the conversation id) decides
   * where each plant stands and when it sprouts.
   */
  let { seed, percent }: { seed: string; percent: number } = $props();

  const layout = $derived(groveLayout(seed));
  const paths = $derived(grovePaths(groveRuns(layout, percent)));
</script>

<!-- Always the same height, so the bar doesn't move when the first plant
     sprouts. The strip is drawn wide enough for any screen and clipped here;
     it is absolutely placed so its width never stretches the pane. -->
<div
  class="relative shrink-0 overflow-hidden"
  style:height="{GROVE_H * GROVE_SCALE}px"
  title="The grove grows as this conversation fills its context window"
  data-testid="context-grove"
>
  <svg
    class="absolute left-0 bottom-0"
    width={GROVE_W * GROVE_SCALE}
    height={GROVE_H * GROVE_SCALE}
    viewBox="0 0 {GROVE_W} {GROVE_H}"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {#each paths as p (p.key)}
      <path d={p.d} fill={p.fill} opacity={p.far ? 0.4 : 1} />
    {/each}
  </svg>
</div>
