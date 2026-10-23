<script>
  import { toRuns, SCENERY_PALETTE } from './app-art.js';

  /**
   * A pixel map (rows of palette keys, `.` is empty) drawn as crisp SVG, at
   * `scale` screen pixels per art pixel. Defaults to the app's scenery palette
   * (bench, lamp, watering can, flag, easel).
   *
   * @type {{ map: string[], palette?: Record<string, string>, scale?: number, class?: string, label?: string }}
   */
  let { map, palette = SCENERY_PALETTE, scale = 4, class: cls = '', label } = $props();

  const runs = $derived(toRuns(map, palette));
  const w = $derived(Math.max(...map.map((r) => r.length)));
  const h = $derived(map.length);
</script>

<svg
  class="pixels {cls}"
  width={w * scale}
  height={h * scale}
  viewBox="0 0 {w} {h}"
  shape-rendering="crispEdges"
  role={label ? 'img' : 'presentation'}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {#each runs as r (`${r.x},${r.y}`)}
    <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
  {/each}
</svg>

<style>
  .pixels {
    display: block;
    flex: none;
    image-rendering: pixelated;
  }
</style>
