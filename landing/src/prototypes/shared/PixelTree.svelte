<script>
  import { treeGreens } from './brand.js';

  /**
   * @type {{ width?: number, opacity?: number, grow?: boolean, delay?: number, class?: string, label?: string }}
   * `grow` pops the pixels in from trunk to crown. `delay` offsets that in seconds.
   */
  let { width = 21, opacity = 1, grow = false, delay = 0, class: className = '', label } = $props();

  const height = $derived(Math.round((width * 24) / 21));
  // Trunk first, crown last: sort by y descending for the grow order.
  const order = [...treeGreens.keys()].sort((a, b) => treeGreens[b].y - treeGreens[a].y);
  const rank = new Map(order.map((index, i) => [index, i]));
</script>

<svg
  {width}
  {height}
  viewBox="0 0 21 24"
  fill="none"
  class="pixel-tree {className}"
  class:grow
  style="opacity: {opacity}; image-rendering: pixelated;"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {#each treeGreens as p, i}
    <rect
      x={p.x}
      y={p.y}
      width="2"
      height="2"
      fill={p.fill}
      style={grow ? `animation-delay: ${delay + rank.get(i) * 0.035}s` : undefined}
    />
  {/each}
</svg>

<style>
  .grow rect {
    transform-box: fill-box;
    transform-origin: center;
    animation: pixel-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  @keyframes pixel-pop {
    from {
      transform: scale(0);
    }
    to {
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grow rect {
      animation: none;
    }
  }
</style>
