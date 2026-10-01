<script>
  import { PIXEL_TREE, PIXEL_TREE_W, PIXEL_TREE_H } from './app-art.js';

  /**
   * The logo tree (the app's title bar art). `growth` from 0 to 1 reveals it
   * from the roots up, for a worktree sprouting. `tint` washes the leaves
   * towards a lane colour.
   *
   * @type {{ scale?: number, growth?: number, tint?: string | null, dim?: boolean, class?: string }}
   */
  let { scale = 3, growth = 1, tint = null, dim = false, class: cls = '' } = $props();

  // Roots first, then the trunk, then the crown from the bottom up.
  const order = [...PIXEL_TREE].sort((a, b) => b.y - a.y || Math.abs(a.x - 9) - Math.abs(b.x - 9));
  const shown = $derived(order.slice(0, Math.round(Math.max(0, Math.min(1, growth)) * order.length)));
  const isLeaf = (p) => p.y < 15;
</script>

<svg
  class="tree {cls}"
  class:dim
  width={PIXEL_TREE_W * scale}
  height={PIXEL_TREE_H * scale}
  viewBox="0 0 {PIXEL_TREE_W} {PIXEL_TREE_H}"
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#each shown as p (`${p.x},${p.y}`)}
    <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {#if tint && isLeaf(p)}
      <rect x={p.x} y={p.y} width="2" height="1" fill={tint} opacity="0.35" />
    {/if}
  {/each}
</svg>

<style>
  .tree {
    display: block;
    flex: none;
    image-rendering: pixelated;
  }
  .dim {
    opacity: 0.35;
  }
</style>
