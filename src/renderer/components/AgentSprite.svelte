<script lang="ts">
  import { AGENT_SPRITES, SPRITE_W, SPRITE_H, agentLook, type AgentSpriteState } from '../lib/agent-sprite.js';

  /** `seed` (the conversation id) picks the skin tone and hair colour. */
  let { state, seed, scale = 2 }: { state: AgentSpriteState; seed?: string; scale?: number } = $props();

  const sprite = $derived(AGENT_SPRITES[state]);
  const animated = $derived(sprite.frames.length > 1);
  const look: Record<string, string> = $derived(seed ? agentLook(seed) : {});
</script>

<svg
  class="agent-sprite shrink-0 {sprite.colorClass}"
  class:animated
  class:pulse-symbol={sprite.pulseSymbol}
  class:fade={sprite.fade}
  width={SPRITE_W * scale}
  height={SPRITE_H * scale}
  viewBox="0 0 {SPRITE_W} {SPRITE_H}"
  shape-rendering="crispEdges"
  style="--frame: {sprite.frameSeconds}s; --frame-w: {SPRITE_W}px"
  role="img"
  aria-label={sprite.label}
  title={sprite.label}
>
  <!-- Frames sit side by side and the viewBox shows one at a time. One
       animation slides the whole strip, so a frame is always in view. -->
  <g class="strip">
    {#each sprite.frames as frame, i (i)}
      <g transform="translate({i * SPRITE_W} 0)">
        {#each frame as run (`${run.x},${run.y}`)}
          <rect x={run.x} y={run.y} width={run.w} height="1" fill={look[run.key] ?? run.fill} class:symbol={run.symbol} />
        {/each}
      </g>
    {/each}
  </g>
</svg>

<style>
  .agent-sprite {
    image-rendering: pixelated;
    overflow: hidden;
  }
  /* Two frames swap at a low, steady rate: a flip-book, not smooth motion. */
  .animated .strip {
    animation: sprite-flip calc(var(--frame) * 2) steps(1, end) infinite;
  }
  /* On SVG content, px in a transform are viewBox units. */
  @keyframes sprite-flip {
    50% { transform: translateX(calc(var(--frame-w) * -1)); }
  }
  /* Same rhythm as Tailwind's animate-pulse on the status dot. */
  .pulse-symbol .symbol,
  .fade {
    animation: sprite-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes sprite-pulse {
    50% { opacity: 0.4; }
  }
  @media (prefers-reduced-motion: reduce) {
    .animated .strip,
    .pulse-symbol .symbol,
    .fade {
      animation: none;
    }
  }
</style>
