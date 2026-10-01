<script>
  import { AGENT_SPRITES, SPRITE_W, SPRITE_H, agentColors } from './app-art.js';
  import { stateColor } from './colors.js';

  /**
   * One grove character, drawn from the app's own sprite data. `seed` (a
   * conversation id) picks skin and hair the way the app does; `look`
   * overrides them ({ h, s, z }). `projectColor` colours the laptop logo.
   * `still` freezes it on its first frame.
   *
   * @type {{
   *   state?: keyof typeof AGENT_SPRITES,
   *   seed?: string,
   *   look?: Record<string, string> | null,
   *   projectColor?: string | null,
   *   scale?: number,
   *   still?: boolean,
   *   label?: string | null,
   *   class?: string,
   * }}
   */
  let { state = 'ready', seed, look = null, projectColor = null, scale = 4, still = false, label = null, class: cls = '' } = $props();

  const sprite = $derived(AGENT_SPRITES[state] ?? AGENT_SPRITES.ready);
  const colors = $derived({ ...agentColors(seed, projectColor), ...(look ?? {}) });
  const animated = $derived(!still && sprite.frames.length > 1);
  const frames = $derived(still ? sprite.frames.slice(0, 1) : sprite.frames);
</script>

<svg
  class="sprite {cls}"
  class:animated
  class:pulse={!still && sprite.pulseSymbol}
  class:fade={!still && sprite.fade}
  width={SPRITE_W * scale}
  height={SPRITE_H * scale}
  viewBox="0 0 {SPRITE_W} {SPRITE_H}"
  shape-rendering="crispEdges"
  style="color: {stateColor(state)}; --frame: {sprite.frameSeconds}s; --frame-w: {SPRITE_W}px"
  role={label === '' ? 'presentation' : 'img'}
  aria-hidden={label === '' ? 'true' : undefined}
  aria-label={label === '' ? undefined : (label ?? sprite.label)}
>
  <g class="strip">
    {#each frames as frame, i (i)}
      <g transform="translate({i * SPRITE_W} 0)">
        {#each frame as run (`${run.x},${run.y}`)}
          <rect x={run.x} y={run.y} width={run.w} height="1" fill={colors[run.key] ?? run.fill} class:symbol={run.symbol} />
        {/each}
      </g>
    {/each}
  </g>
</svg>

<style>
  .sprite {
    display: block;
    flex: none;
    overflow: hidden;
    image-rendering: pixelated;
  }
  .animated .strip {
    animation: flip calc(var(--frame) * 2) steps(1, end) infinite;
  }
  @keyframes flip {
    50% {
      transform: translateX(calc(var(--frame-w) * -1));
    }
  }
  .pulse :global(.symbol),
  .fade {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animated .strip,
    .pulse :global(.symbol),
    .fade {
      animation: none;
    }
  }
</style>
