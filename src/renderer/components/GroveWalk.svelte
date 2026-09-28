<script lang="ts">
  import { AGENT_SPRITES, SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, SPRITE_W, SPRITE_H, agentLook, toRuns } from '../lib/agent-sprite.js';
  import {
    WALK_BACK, WALK_FRONT, WALK_VIEW_W, WALK_VIEW_H, WALK_GROUND_Y, WALK_FRAME_SECONDS,
    WAKE_PATH_HEAD_START_SECONDS, WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS,
    wakePhase, type WakePhase,
  } from '../lib/grove-walk.js';
  import type { WakeScene } from '../stores/wakeScene.svelte.js';

  /**
   * Grove character version of "Starting agent...": the conversation's agent
   * walks through the grove until it is ready. `seed` (the conversation id)
   * gives it the same skin tone and hair colour as in the sidebar. With
   * `wake`, it first wakes up on a bench, then stands and walks off.
   */
  let { seed, wake = null }: { seed: string; wake?: WakeScene | null } = $props();

  const SCALE = 4;
  const frames = SIDE_WALK_MAPS.map((map) => toRuns(map));
  const look: Record<string, string> = $derived(agentLook(seed));
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

  const seated = $derived(
    phase === 'asleep'
      ? AGENT_SPRITES[wake?.from ?? 'sleeping']
      : AGENT_SPRITES.ready,
  );
</script>

<div class="relative z-10 flex flex-col items-center text-center">
  <svg
    class="walk"
    class:still={phase !== 'walking'}
    width={WALK_VIEW_W * SCALE}
    height={WALK_VIEW_H * SCALE}
    viewBox="0 0 {WALK_VIEW_W} {WALK_VIEW_H}"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {#key wokeAt}
    {#each [WALK_BACK, WALK_FRONT] as layer, i (i)}
      <!-- For a wake-up the path starts part way round, at its bench. -->
      {@const headStart = wokeAt && layer === WALK_FRONT ? WAKE_PATH_HEAD_START_SECONDS : 0}
      <g class="layer" class:far={layer === WALK_BACK} style="--width: {layer.width}px; --steps: {layer.width}; --seconds: {layer.seconds}s; animation-delay: -{headStart}s">
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
    {#if phase === 'walking'}
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
    {:else}
      <!-- Seated on the bench: asleep in the colour of the state it wakes
           from, then eyes open in the "Starting" colour. -->
      <svg
        class="seated {phase === 'asleep' ? seated.colorClass : AGENT_SPRITES.starting.colorClass}"
        x={agentX}
        y={seatedY}
        width={SPRITE_W}
        height={SPRITE_H}
        viewBox="0 0 {SPRITE_W} {SPRITE_H}"
      >
        {#each seated.frames[0] as run (`${run.x},${run.y}`)}
          <rect x={run.x} y={run.y} width={run.w} height="1" fill={look[run.key] ?? run.fill} />
        {/each}
      </svg>
    {/if}
  </svg>
  <p class="text-sm mt-4 text-muted-foreground">{phase === 'walking' ? 'Starting agent...' : 'Waking up...'}</p>
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
    .strip {
      animation: none;
    }
  }
</style>
