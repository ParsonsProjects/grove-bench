<script lang="ts">
  import { AGENT_SPRITES, SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, agentLook, toRuns } from '../lib/agent-sprite.js';
  import { WALK_BACK, WALK_FRONT, WALK_VIEW_W, WALK_VIEW_H, WALK_GROUND_Y, WALK_FRAME_SECONDS } from '../lib/grove-walk.js';

  /**
   * Grove character version of "Starting agent...": the conversation's agent
   * walks through the grove until it is ready. `seed` (the conversation id)
   * gives it the same skin tone and hair colour as in the sidebar.
   */
  let { seed }: { seed: string } = $props();

  const SCALE = 4;
  const frames = SIDE_WALK_MAPS.map((map) => toRuns(map));
  const look: Record<string, string> = $derived(agentLook(seed));
  const agentX = (WALK_VIEW_W - SIDE_WALK_W) / 2;
  const agentY = WALK_GROUND_Y - SIDE_WALK_H;
</script>

<div class="relative z-10 flex flex-col items-center text-center">
  <svg
    class="walk"
    width={WALK_VIEW_W * SCALE}
    height={WALK_VIEW_H * SCALE}
    viewBox="0 0 {WALK_VIEW_W} {WALK_VIEW_H}"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {#each [WALK_BACK, WALK_FRONT] as layer, i (i)}
      <g class="layer" class:far={layer === WALK_BACK} style="--width: {layer.width}px; --steps: {layer.width}; --seconds: {layer.seconds}s">
        <!-- Two copies side by side: when the first has slid out, the second
             sits where it started and the loop begins again. -->
        {#each [0, layer.width] as offset (offset)}
          <g transform="translate({offset} 0)">
            {#each layer.rects as r, j (j)}
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
            {/each}
          </g>
        {/each}
      </g>
    {/each}
    <rect x="0" y={WALK_GROUND_Y} width={WALK_VIEW_W} height="1" fill="#3a9a48" opacity="0.45" />
    <!-- The agent, in the sidebar's "Starting" colour. Its frames sit side by
         side and this viewBox shows one at a time, as in AgentSprite. -->
    <svg
      class={AGENT_SPRITES.starting.colorClass}
      x={agentX}
      y={agentY}
      width={SIDE_WALK_W}
      height={SIDE_WALK_H}
      viewBox="0 0 {SIDE_WALK_W} {SIDE_WALK_H}"
      style="--frame: {WALK_FRAME_SECONDS}s; --frame-w: {SIDE_WALK_W}px"
    >
      <g class="strip">
        {#each frames as frame, i (i)}
          <g transform="translate({i * SIDE_WALK_W} 0)">
            {#each frame as run (`${run.x},${run.y}`)}
              <rect x={run.x} y={run.y} width={run.w} height="1" fill={look[run.key] ?? run.fill} />
            {/each}
          </g>
        {/each}
      </g>
    </svg>
  </svg>
  <p class="text-sm mt-4 text-muted-foreground">Starting agent...</p>
</div>

<style>
  .walk {
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
    /* Props fade in and out at the edges rather than popping. */
    mask-image: linear-gradient(to right, transparent, #000 15%, #000 85%, transparent);
  }
  .far {
    opacity: 0.35;
  }
  /* Whole-pixel steps keep the art crisp and repaint only a few times a second. */
  .layer {
    animation: walk-scroll var(--seconds) steps(var(--steps), end) infinite;
  }
  /* On SVG content, px in a transform are viewBox units. */
  @keyframes walk-scroll {
    to { transform: translateX(calc(var(--width) * -1)); }
  }
  .strip {
    animation: walk-flip calc(var(--frame) * 2) steps(1, end) infinite;
  }
  @keyframes walk-flip {
    50% { transform: translateX(calc(var(--frame-w) * -1)); }
  }
  /* Standing still in the passing pose, with the grove at rest. */
  @media (prefers-reduced-motion: reduce) {
    .layer,
    .strip {
      animation: none;
    }
  }
</style>
