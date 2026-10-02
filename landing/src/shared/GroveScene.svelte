<script>
  import Sprite from './Sprite.svelte';
  import { PIXEL_TREE, BENCH, LAMP, SPROUT, WATERING_CAN, FLAG, EASEL, SCENERY_PALETTE, SPRITE_H, toRuns } from './app-art.js';

  /**
   * The app's empty-state scene (GroveEmptyState.svelte), at the same art
   * coordinates: the logo tree, a bench, and an unlit lamp or a tab's own
   * props. With `state`, an agent sits on the bench.
   *
   * @type {{ tab?: 'none' | 'changes' | 'checkpoints' | 'preview', state?: string | null, seed?: string, look?: Record<string, string> | null, scale?: number }}
   */
  let { tab = 'none', state = null, seed, look = null, scale = 4 } = $props();

  const W = 56;
  const H = 30;
  const GROUND_Y = 29;
  const BENCH_X = 29;
  const BENCH_Y = GROUND_Y - BENCH.length;
  const SEAT_X = BENCH_X + (BENCH[0].length - 6) / 2;
  const SEAT_Y = GROUND_Y - SPRITE_H;

  const PROPS = {
    none: [{ name: 'lamp', map: LAMP, x: 46 }],
    changes: [
      { name: 'sprout', map: SPROUT, x: 43 },
      { name: 'watering-can', map: WATERING_CAN, x: 47 },
    ],
    checkpoints: [{ name: 'flag', map: FLAG, x: 45 }],
    preview: [{ name: 'easel', map: EASEL, x: 44 }],
  };

  const bench = toRuns(BENCH, SCENERY_PALETTE);
  const props = $derived(PROPS[tab].map((p) => ({ ...p, y: GROUND_Y - p.map.length, runs: toRuns(p.map, SCENERY_PALETTE) })));
</script>

<div class="scene" style="width: {W * scale}px; height: {H * scale}px">
  <svg width={W * scale} height={H * scale} viewBox="0 0 {W} {H}" shape-rendering="crispEdges" aria-hidden="true">
    <g transform="translate(6 5)">
      {#each PIXEL_TREE as p (`${p.x},${p.y}`)}
        <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
      {/each}
    </g>
    <g transform="translate({BENCH_X} {BENCH_Y})">
      {#each bench as r (`${r.x},${r.y}`)}
        <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
      {/each}
    </g>
    {#each props as p (p.name)}
      <g transform="translate({p.x} {p.y})">
        {#each p.runs as r (`${r.x},${r.y}`)}
          <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
        {/each}
      </g>
    {/each}
    <rect x="0" y={GROUND_Y} width={W} height="1" fill="#3a9a48" opacity="0.45" />
  </svg>
  {#if state}
    <span class="agent" style="left: {SEAT_X * scale}px; top: {SEAT_Y * scale}px">
      <Sprite {state} {seed} {look} {scale} />
    </span>
  {/if}
</div>

<style>
  .scene {
    position: relative;
    flex: none;
    max-width: 100%;
  }
  svg {
    display: block;
    image-rendering: pixelated;
  }
  .agent {
    position: absolute;
    line-height: 0;
  }
</style>
