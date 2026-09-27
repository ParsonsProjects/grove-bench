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
  style="--frame: {sprite.frameSeconds}s"
  role="img"
  aria-label={sprite.label}
>
  <title>{sprite.label}</title>
  {#each sprite.frames as frame, i (i)}
    <g class="frame frame-{i}">
      {#each frame as run (`${run.x},${run.y}`)}
        <rect x={run.x} y={run.y} width={run.w} height="1" fill={look[run.key] ?? run.fill} class:symbol={run.symbol} />
      {/each}
    </g>
  {/each}
</svg>

<style>
  .agent-sprite {
    image-rendering: pixelated;
  }
  .frame-1 {
    visibility: hidden;
  }
  /* Two frames swap at a low, steady rate: a flip-book, not smooth motion. */
  .animated .frame-0 {
    animation: sprite-frame-a calc(var(--frame) * 2) steps(1, end) infinite;
  }
  .animated .frame-1 {
    animation: sprite-frame-b calc(var(--frame) * 2) steps(1, end) infinite;
  }
  @keyframes sprite-frame-a {
    0% { visibility: visible; }
    50% { visibility: hidden; }
  }
  @keyframes sprite-frame-b {
    0% { visibility: hidden; }
    50% { visibility: visible; }
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
    .animated .frame-0 {
      animation: none;
    }
    .animated .frame-1 {
      animation: none;
      visibility: hidden;
    }
    .pulse-symbol .symbol,
    .fade {
      animation: none;
    }
  }
</style>
