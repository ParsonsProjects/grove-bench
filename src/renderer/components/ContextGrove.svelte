<script lang="ts">
  import { untrack } from 'svelte';
  import { prefersReducedMotion } from '$lib/utils.js';
  import { GROVE_W, GROVE_H, GROVE_SCALE, GROVE_STEP_MS, GroveGrowth, groveLayout, groveRuns, grovePaths, type GroveFrame } from '../lib/context-grove.js';

  /**
   * A strip of grove along the top of the status bar that fills in as the
   * conversation uses its context window. `seed` (the conversation id) decides
   * where each plant stands and when it sprouts. With `animate`, each change
   * plays out: plants sprout one after another and rise out of the ground.
   * Without it (a hidden conversation), the grove jumps straight there, so
   * nothing replays when you switch to it.
   */
  let { seed, percent, animate = false }: { seed: string; percent: number; animate?: boolean } = $props();

  const layout = $derived(groveLayout(seed));
  let player: GroveGrowth | null = null;
  let frame = $state<GroveFrame>({ percent: 0, growth: new Map(), done: true });

  $effect(() => {
    const target = percent;
    if (player?.plants !== layout) player = new GroveGrowth(layout, untrack(() => frame.percent));
    const grove = player;
    if (!animate || prefersReducedMotion()) {
      grove.settle(target);
      frame = grove.frame(Date.now());
      return;
    }
    grove.retarget(target, Date.now());
    const timer = setInterval(() => {
      frame = grove.frame(Date.now());
      if (frame.done) clearInterval(timer);
    }, GROVE_STEP_MS);
    frame = grove.frame(Date.now());
    return () => clearInterval(timer);
  });

  const paths = $derived(grovePaths(groveRuns(layout, frame.percent, frame.growth)));
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
