<script>
  import { untrack } from 'svelte';
  import { GROVE_H, GROVE_STEP_MS, GroveGrowth, groveLayout, groveRuns, grovePaths } from './app-art.js';

  /**
   * The app's context grove: plants that fill in as a conversation uses its
   * context window, and thin out after /compact. Same layout and growth code
   * as the status bar strip, clipped to `width` art pixels.
   *
   * @type {{ seed: string, percent: number, width?: number, scale?: number, animate?: boolean }}
   */
  let { seed, percent, width = 120, scale = 3, animate = true } = $props();

  const layout = $derived(groveLayout(seed));
  /** @type {GroveGrowth | null} */
  let player = null;
  let frame = $state({ percent: 0, growth: new Map(), done: true });

  $effect(() => {
    const target = percent;
    if (player?.plants !== layout) player = new GroveGrowth(layout, untrack(() => frame.percent));
    const grove = player;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced) {
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

<svg
  class="strip"
  width={width * scale}
  height={GROVE_H * scale}
  viewBox="0 0 {width} {GROVE_H}"
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#each paths as p (p.key)}
    <path d={p.d} fill={p.fill} opacity={p.far ? 0.4 : 1} />
  {/each}
</svg>

<style>
  .strip {
    display: block;
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
  }
</style>
