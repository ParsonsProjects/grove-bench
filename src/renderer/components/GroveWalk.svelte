<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AGENT_SPRITES, SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, SPRITE_W, SPRITE_H, agentColors, toRuns, type AgentSpriteState } from '../lib/agent-sprite.js';
  import {
    WALK_BACK, WALK_FRONT, WALK_VIEW_W, WALK_VIEW_H, WALK_GROUND_Y, WALK_FRAME_SECONDS,
    WAKE_PATH_HEAD_START_SECONDS, WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS,
    BENCH_PATH_OFFSET, ARRIVE_PATH_FROM, ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS,
    wakePhase, arrivePhase, type WakePhase, type ArrivePhase,
  } from '../lib/grove-walk.js';
  import { prefersReducedMotion } from '../lib/utils.js';
  import type { WakeScene } from '../stores/wakeScene.svelte.js';

  /**
   * Grove character version of "Starting agent...": the conversation's agent
   * walks through the grove until it is ready. `seed` (the conversation id)
   * gives it the same skin tone and hair colour as in the sidebar,
   * `projectColor` the same laptop logo, and `spriteState` (the sidebar
   * character's state) the same hoodie colour. With `wake`, it first wakes up
   * on a bench, then stands and walks off. With `arrival` (when that scene
   * began), it walks up to the bench instead, sits down and, once
   * `spriteState` says its agent is working, types on its laptop. `caption`
   * replaces the text under the art.
   */
  let { seed, projectColor = null, spriteState = 'starting', wake = null, arrival = null, caption }: {
    seed: string;
    projectColor?: string | null;
    spriteState?: AgentSpriteState;
    wake?: WakeScene | null;
    arrival?: number | null;
    caption?: Snippet;
  } = $props();

  const SCALE = 4;
  const frames = SIDE_WALK_MAPS.map((map) => toRuns(map));
  const look = $derived(agentColors(seed, projectColor));
  const colorClass = $derived(AGENT_SPRITES[spriteState].colorClass);
  const agentX = (WALK_VIEW_W - SIDE_WALK_W) / 2;
  const agentY = WALK_GROUND_Y - SIDE_WALK_H;
  // Seated front-on on the path's bench, feet on the ground. Columns 0 to 5
  // are the body, so it sits where the walker will stand.
  const seatedY = WALK_GROUND_Y - SPRITE_H;

  // Advances on timers from the scene's start, so a walk mounted before the
  // scene began (a stopped conversation) still starts from asleep.
  let scenePhase = $state<WakePhase>('walking');
  // Set when a wake-up starts and kept after it ends, so the grove restarts
  // once, at the bench, and then carries on from there.
  let wokeAt = $state(0);
  $effect(() => {
    if (!wake) {
      scenePhase = 'walking';
      return;
    }
    wokeAt = wake.startedAt;
    const elapsed = Date.now() - wake.startedAt;
    scenePhase = wakePhase(elapsed);
    const timers = [WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS]
      .filter((at) => at > elapsed)
      .map((at) => setTimeout(() => { scenePhase = wakePhase(at); }, at - elapsed));
    return () => timers.forEach(clearTimeout);
  });
  const phase = $derived(wake ? scenePhase : 'walking');

  // The arrival, on timers from when it began, so coming back to it part way
  // through carries on from there. With reduced motion the agent is already
  // on the bench. `joined` is how far in it was on mount, for the path.
  let arrived = $state<ArrivePhase>('walking');
  let joined = $state(0);
  $effect(() => {
    if (arrival === null) return;
    const elapsed = prefersReducedMotion() ? Infinity : Date.now() - arrival;
    joined = elapsed;
    arrived = arrivePhase(elapsed);
    const timers = [ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS]
      .filter((at) => at > elapsed)
      .map((at) => setTimeout(() => { arrived = arrivePhase(at); }, at - elapsed));
    return () => timers.forEach(clearTimeout);
  });
  // Walking up to the bench, or sat on it with the path parked there.
  const arriving = $derived(arrival !== null && arrived === 'walking');
  const parked = $derived(arrival !== null && arrived !== 'walking');

  // The seated pose, or null while walking. Waking: asleep as it was in the
  // sidebar, then eyes open. Arriving: laptop open, typing while its agent works.
  const seated = $derived.by(() => {
    if (phase !== 'walking') return phase === 'asleep' ? AGENT_SPRITES[wake?.from ?? 'sleeping'] : AGENT_SPRITES.ready;
    if (parked) return arrived === 'typing' && spriteState === 'working' ? AGENT_SPRITES.working : AGENT_SPRITES.ready;
    return null;
  });
</script>

<div class="relative z-10 flex flex-col items-center text-center">
  <svg
    class="walk"
    class:still={seated !== null}
    width={WALK_VIEW_W * SCALE}
    height={WALK_VIEW_H * SCALE}
    viewBox="0 0 {WALK_VIEW_W} {WALK_VIEW_H}"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {#key `${wokeAt}:${arrival}`}
    {#each [WALK_BACK, WALK_FRONT] as layer, i (i)}
      {@const path = layer === WALK_FRONT}
      <!-- For a wake-up the path starts part way round, at its bench. -->
      {@const headStart = wokeAt && path ? WAKE_PATH_HEAD_START_SECONDS : 0}
      <!-- For an arrival it walks once, from short of the bench to the bench,
           and then stays there. -->
      <g
        class="layer"
        class:far={!path}
        class:arriving={path && arriving}
        class:parked={path && parked}
        style={path && arrival !== null
          ? `--from: -${ARRIVE_PATH_FROM}px; --to: -${BENCH_PATH_OFFSET}px; --steps: ${BENCH_PATH_OFFSET - ARRIVE_PATH_FROM}; --seconds: ${ARRIVE_SIT_AT_MS / 1000}s; animation-delay: -${Math.min(joined, ARRIVE_SIT_AT_MS) / 1000}s`
          : `--width: ${layer.width}px; --steps: ${layer.width}; --seconds: ${layer.seconds}s; animation-delay: -${headStart}s`}
      >
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
    {/key}
    <rect x="0" y={WALK_GROUND_Y} width={WALK_VIEW_W} height="1" fill="#3a9a48" opacity="0.45" />
    {#if !seated}
      <!-- The agent, in its sidebar colour. Its frames sit side by side and
           this viewBox shows one at a time, as in AgentSprite. -->
      <svg
        class={colorClass}
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
    {:else}
      <!-- Seated on the bench, in its sidebar colour. Typing swaps two frames,
           as in AgentSprite. -->
      <svg
        class="seated {colorClass}"
        x={agentX}
        y={seatedY}
        width={SPRITE_W}
        height={SPRITE_H}
        viewBox="0 0 {SPRITE_W} {SPRITE_H}"
        style="--frame: {seated.frameSeconds}s; --frame-w: {SPRITE_W}px"
      >
        <g class:strip={seated.frames.length > 1}>
          {#each seated.frames as frame, i (i)}
            <g transform="translate({i * SPRITE_W} 0)">
              {#each frame as run (`${run.x},${run.y}`)}
                <rect x={run.x} y={run.y} width={run.w} height="1" fill={look[run.key] ?? run.fill} />
              {/each}
            </g>
          {/each}
        </g>
      </svg>
    {/if}
  </svg>
  {#if caption}
    {@render caption()}
  {:else}
    <p class="text-sm mt-4 text-muted-foreground">{phase === 'walking' ? 'Starting agent...' : 'Waking up...'}</p>
  {/if}
  {#if wake}
    <p class="text-xs mt-1 text-muted-foreground/60">Click or press any key to skip</p>
  {/if}
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
  /* The arrival's one walk, which holds at the bench when it ends. */
  .layer.arriving {
    animation: walk-arrive var(--seconds) steps(var(--steps), end) both;
  }
  @keyframes walk-arrive {
    from { transform: translateX(var(--from)); }
    to { transform: translateX(var(--to)); }
  }
  /* Set rather than held by the animation, so it is exact, and there with
     reduced motion too. */
  .layer.parked {
    animation: none;
    transform: translateX(var(--to));
  }
  /* Before the agent walks, the grove holds still. */
  .still .layer {
    animation-play-state: paused;
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
    .layer.arriving,
    .strip {
      animation: none;
    }
  }
</style>
