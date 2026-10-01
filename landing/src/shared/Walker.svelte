<script>
  import { SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, WALK_FRAME_SECONDS, toRuns, agentColors } from './app-art.js';
  import { stateColor } from './colors.js';

  /**
   * The side-on walker from the app's grove walk (starting up, waking). Faces
   * right; `flip` faces it left.
   *
   * @type {{ seed?: string, look?: Record<string, string> | null, state?: string, scale?: number, flip?: boolean, still?: boolean }}
   */
  let { seed, look = null, state = 'starting', scale = 4, flip = false, still = false } = $props();

  const frames = SIDE_WALK_MAPS.map((m) => toRuns(m));
  const colors = $derived({ ...agentColors(seed), ...(look ?? {}) });
</script>

<svg
  class="walker"
  class:flip
  class:animated={!still}
  width={SIDE_WALK_W * scale}
  height={SIDE_WALK_H * scale}
  viewBox="0 0 {SIDE_WALK_W} {SIDE_WALK_H}"
  shape-rendering="crispEdges"
  style="color: {stateColor(state)}; --frame: {WALK_FRAME_SECONDS}s; --frame-w: {SIDE_WALK_W}px"
  aria-hidden="true"
>
  <g class="strip">
    {#each still ? frames.slice(0, 1) : frames as frame, i (i)}
      <g transform="translate({i * SIDE_WALK_W} 0)">
        {#each frame as run (`${run.x},${run.y}`)}
          <rect x={run.x} y={run.y} width={run.w} height="1" fill={colors[run.key] ?? run.fill} />
        {/each}
      </g>
    {/each}
  </g>
</svg>

<style>
  .walker {
    display: block;
    flex: none;
    overflow: hidden;
    image-rendering: pixelated;
  }
  .flip {
    transform: scaleX(-1);
  }
  .animated .strip {
    animation: flip-frames calc(var(--frame) * 2) steps(1, end) infinite;
  }
  @keyframes flip-frames {
    50% {
      transform: translateX(calc(var(--frame-w) * -1));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animated .strip {
      animation: none;
    }
  }
</style>
