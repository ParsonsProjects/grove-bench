<script>
  import { untrack } from 'svelte';
  import {
    AGENT_SPRITES, SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, SPRITE_W, SPRITE_H, toRuns, agentColors,
    WALK_BACK, WALK_FRONT, WALK_VIEW_W, WALK_VIEW_H, WALK_GROUND_Y, WALK_FRAME_SECONDS,
    WAKE_PATH_HEAD_START_SECONDS, WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS,
    BENCH_PATH_OFFSET, ARRIVE_PATH_FROM, ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS, wakePhase, arrivePhase,
  } from './app-art.js';
  import { stateColor } from './colors.js';

  /**
   * The app's grove walk (src/renderer/components/GroveWalk.svelte), on the
   * same layers and timings. `mode`: 'walk' loops the path; 'arrive' walks up
   * to the bench, sits down and types; 'wake' wakes on the bench, then stands
   * and walks off. Changing `run` restarts the scene.
   *
   * @type {{ mode?: 'walk' | 'arrive' | 'wake', run?: number, seed?: string, look?: Record<string, string> | null, wakeFrom?: string, scale?: number }}
   */
  let { mode = 'walk', run = 0, seed, look = null, wakeFrom = 'sleeping', scale = 4 } = $props();

  const frames = SIDE_WALK_MAPS.map((m) => toRuns(m));
  const colors = $derived({ ...agentColors(seed), ...(look ?? {}) });
  const agentX = (WALK_VIEW_W - SIDE_WALK_W) / 2;
  const agentY = WALK_GROUND_Y - SIDE_WALK_H;
  const seatedY = WALK_GROUND_Y - SPRITE_H;

  let elapsed = $state(0);
  $effect(() => {
    run;
    mode;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = Date.now();
    elapsed = reduced && mode === 'arrive' ? Infinity : 0;
    const marks = mode === 'wake' ? [WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS] : mode === 'arrive' ? [ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS] : [];
    if (untrack(() => elapsed) === Infinity) return;
    const timers = marks.map((at) => setTimeout(() => (elapsed = Date.now() - start), at));
    return () => timers.forEach(clearTimeout);
  });

  const wake = $derived(mode === 'wake' ? wakePhase(elapsed) : null);
  const arrive = $derived(mode === 'arrive' ? arrivePhase(elapsed) : null);
  // Sat on the bench (and which pose), or null while walking.
  const seated = $derived.by(() => {
    if (wake && wake !== 'walking') return wake === 'asleep' ? AGENT_SPRITES[wakeFrom] : AGENT_SPRITES.ready;
    if (arrive && arrive !== 'walking') return arrive === 'typing' ? AGENT_SPRITES.working : AGENT_SPRITES.ready;
    return null;
  });
  const color = $derived(stateColor(seated === AGENT_SPRITES.working ? 'working' : seated ? (wake === 'asleep' ? wakeFrom : 'ready') : 'starting'));
</script>

<svg
  class="walk"
  class:still={seated !== null}
  width={WALK_VIEW_W * scale}
  height={WALK_VIEW_H * scale}
  viewBox="0 0 {WALK_VIEW_W} {WALK_VIEW_H}"
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#key `${mode}:${run}`}
    {#each [WALK_BACK, WALK_FRONT] as layer, i (i)}
      {@const path = layer === WALK_FRONT}
      {@const headStart = mode === 'wake' && path ? WAKE_PATH_HEAD_START_SECONDS : 0}
      <g
        class="layer"
        class:far={!path}
        class:arriving={path && mode === 'arrive' && arrive === 'walking'}
        class:parked={path && mode === 'arrive' && arrive !== 'walking'}
        style={path && mode === 'arrive'
          ? `--from: -${ARRIVE_PATH_FROM}px; --to: -${BENCH_PATH_OFFSET}px; --steps: ${Math.round(BENCH_PATH_OFFSET - ARRIVE_PATH_FROM)}; --seconds: ${ARRIVE_SIT_AT_MS / 1000}s`
          : `--width: ${layer.width}px; --steps: ${layer.width}; --seconds: ${layer.seconds}s; animation-delay: -${headStart}s`}
      >
        {#each [0, layer.width] as offset (offset)}
          <g transform="translate({offset} 0)">
            {#each layer.rects as r, j (j)}
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
            {/each}
          </g>
        {/each}
      </g>
    {/each}
  {/key}
  <rect x="0" y={WALK_GROUND_Y} width={WALK_VIEW_W} height="1" fill="#3a9a48" opacity="0.45" />
  {#if !seated}
    <svg x={agentX} y={agentY} width={SIDE_WALK_W} height={SIDE_WALK_H} viewBox="0 0 {SIDE_WALK_W} {SIDE_WALK_H}" style="color: {color}; --frame: {WALK_FRAME_SECONDS}s; --frame-w: {SIDE_WALK_W}px">
      <g class="strip">
        {#each frames as frame, i (i)}
          <g transform="translate({i * SIDE_WALK_W} 0)">
            {#each frame as r (`${r.x},${r.y}`)}
              <rect x={r.x} y={r.y} width={r.w} height="1" fill={colors[r.key] ?? r.fill} />
            {/each}
          </g>
        {/each}
      </g>
    </svg>
  {:else}
    <svg x={agentX} y={seatedY} width={SPRITE_W} height={SPRITE_H} viewBox="0 0 {SPRITE_W} {SPRITE_H}" style="color: {color}; --frame: {seated.frameSeconds}s; --frame-w: {SPRITE_W}px">
      <g class:strip={seated.frames.length > 1}>
        {#each seated.frames as frame, i (i)}
          <g transform="translate({i * SPRITE_W} 0)">
            {#each frame as r (`${r.x},${r.y}`)}
              <rect x={r.x} y={r.y} width={r.w} height="1" fill={colors[r.key] ?? r.fill} />
            {/each}
          </g>
        {/each}
      </g>
    </svg>
  {/if}
</svg>

<style>
  .walk {
    display: block;
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
    mask-image: linear-gradient(to right, transparent, #000 15%, #000 85%, transparent);
  }
  .far {
    opacity: 0.35;
  }
  .layer {
    animation: walk-scroll var(--seconds) steps(var(--steps), end) infinite;
  }
  @keyframes walk-scroll {
    to {
      transform: translateX(calc(var(--width) * -1));
    }
  }
  .layer.arriving {
    animation: walk-arrive var(--seconds) steps(var(--steps), end) both;
  }
  @keyframes walk-arrive {
    from {
      transform: translateX(var(--from));
    }
    to {
      transform: translateX(var(--to));
    }
  }
  .layer.parked {
    animation: none;
    transform: translateX(var(--to));
  }
  .still .layer {
    animation-play-state: paused;
  }
  .strip {
    animation: walk-flip calc(var(--frame) * 2) steps(1, end) infinite;
  }
  @keyframes walk-flip {
    50% {
      transform: translateX(calc(var(--frame-w) * -1));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .layer,
    .layer.arriving,
    .strip {
      animation: none;
    }
  }
</style>
