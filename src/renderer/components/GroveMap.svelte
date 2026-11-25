<script lang="ts">
  import { untrack } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import AgentSprite from './AgentSprite.svelte';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import { sessionRepoColor } from '../lib/session-repo-color.js';
  import { agentUp } from '../lib/thread-working.js';
  import { AGENT_SPRITES, SPRITE_W, type AgentSpriteState } from '../lib/agent-sprite.js';
  import { layoutGroveMap, MAP_SCALE, type MapProject } from '../lib/grove-map.js';

  /**
   * The grove map (alpha, Settings > Grove map): the landing when no thread
   * is open, in place of the Pick a thread list. The same open threads, as
   * people at desks in a room per project (lib/grove-map.ts lays it out).
   * Click someone to open their thread; drag the map to look around.
   *
   * The scenery is one canvas, drawn at one pixel per art unit and scaled up
   * with crisp edges. The people are the grove characters (AgentSprite),
   * with their states, colours and labels, drawn over it with their tags.
   */

  // Same list and order as Pick a thread (and the sidebar), a room per project.
  let projects = $derived.by((): MapProject[] => {
    const byRepo = new Map<string, MapProject>();
    for (const s of store.openConversations) {
      let p = byRepo.get(s.repoPath);
      if (!p) {
        p = { repo: s.repoPath, name: store.repoDisplayName(s.repoPath), color: sessionRepoColor(s.id), threads: [] };
        byRepo.set(s.repoPath, p);
      }
      p.threads.push({
        id: s.id,
        name: s.displayName || s.branch || 'New thread',
        state: sessionSpriteState(s),
        helpers: agentUp(s) ? backgroundTaskStore.runningAgents(s.id).length : 0,
      });
    }
    return [...byRepo.values()];
  });
  let map = $derived(layoutGroveMap(projects));

  // The scenery only changes with the rooms: which projects, their colours
  // and how many threads each has, not what the threads are doing.
  let shape = $derived(projects.map((p) => `${p.repo}\u0000${p.color ?? ''}\u0000${p.threads.length}`).join('\u0001'));

  let canvas = $state<HTMLCanvasElement>();
  $effect(() => {
    void shape;
    const el = canvas;
    if (!el) return;
    const scenery = untrack(() => map.scenery);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = el.getContext('2d');
    } catch {
      // No canvas (tests): the people and their tags still show.
    }
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    for (const p of scenery) {
      ctx.fillStyle = p.fill;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  });

  /** Each state's screen: lit in the status colour while something is
   *  going on, dark when the thread is quiet. */
  const SCREEN_CLASS: Partial<Record<AgentSpriteState, string>> = {
    working: 'bg-status-working',
    starting: 'bg-status-working',
    installing: 'bg-status-working',
    permission: 'bg-status-attention',
    asking: 'bg-status-attention',
    unread: 'bg-status-unread',
    error: 'bg-status-error',
  };

  // Drag to look around. A drag that moved doesn't open the person it
  // started on.
  let viewport = $state<HTMLDivElement>();
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let dragged = false;

  function onpointerdown(e: PointerEvent) {
    dragged = false;
    if (e.button !== 0 || !viewport) return;
    drag = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
  }
  function onpointermove(e: PointerEvent) {
    if (!drag || !viewport) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      viewport.setPointerCapture?.(e.pointerId);
    }
    if (drag.moved) {
      viewport.scrollLeft = drag.left - dx;
      viewport.scrollTop = drag.top - dy;
    }
  }
  function onpointerup() {
    if (drag?.moved) dragged = true;
    drag = null;
  }

  function open(id: string) {
    if (dragged) return;
    store.activeSessionId = id;
    store.clearNeedsAttention(id);
  }
</script>

<div class="flex-1 min-h-0 flex flex-col bg-background">
  <div class="flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-b border-border shrink-0">
    <h1 class="font-pixel text-base text-foreground/90">Pick a thread</h1>
    <p class="text-caption text-muted-foreground">Click someone to open their thread, or choose one from the sidebar. Drag the map to look around.</p>
  </div>

  <div
    bind:this={viewport}
    class="map-viewport flex-1 min-h-0 overflow-auto"
    role="presentation"
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
  >
    <div
      class="relative mx-auto overflow-hidden select-none"
      style="width: {map.width}px; height: {map.height}px"
      role="group"
      aria-label="Threads by project"
      data-grove-map
    >
      <canvas
        bind:this={canvas}
        class="map-scenery absolute inset-0"
        width={map.cols}
        height={map.rows}
        style="width: {map.width}px; height: {map.height}px"
        aria-hidden="true"
      ></canvas>

      {#each map.rooms as room (room.repo)}
        <section class="absolute" style="left: {room.x}px; top: {room.y}px; width: {room.w}px; height: {room.h}px" aria-label={room.name}>
          <!-- The room's sign, on its back wall. Part of the scenery, so in its colours. -->
          <div class="room-sign absolute left-1/2 -translate-x-1/2 top-1.5 flex items-center gap-2 px-2.5 py-1 whitespace-nowrap">
            {#if room.color}<span class="size-2 shrink-0" style="background: {room.color}" aria-hidden="true"></span>{/if}
            <h2 class="font-pixel text-base leading-4">{room.name}</h2>
            <span class="text-caption room-sign-count">{room.threads} {room.threads === 1 ? 'thread' : 'threads'}</span>
          </div>

          {#each map.helpers.filter((h) => h.repo === room.repo) as h (h.key)}
            <span class="absolute pointer-events-none" style="left: {h.x - room.x}px; top: {h.y - room.y}px" aria-hidden="true">
              <AgentSprite state="working" seed={h.seed} projectColor={h.projectColor} scale={MAP_SCALE / 2} facing="back" />
            </span>
          {/each}

          {#each map.seats.filter((s) => s.repo === room.repo) as seat (seat.id)}
            <button
              type="button"
              class="seat absolute text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-accent/40"
              style="left: {seat.x - room.x}px; top: {seat.y - room.y}px; width: {seat.w}px; height: {seat.h}px"
              aria-label="{seat.name}: {AGENT_SPRITES[seat.state].label}"
              title={seat.name}
              data-seat={seat.id}
              onclick={() => open(seat.id)}
            >
              {#if seat.screen}
                <span
                  class="screen absolute {SCREEN_CLASS[seat.state] ?? 'screen-off'}"
                  style="left: {seat.screen.x}px; top: {seat.screen.y}px; width: {SPRITE_W * MAP_SCALE * 0.6}px; height: {MAP_SCALE * 3}px"
                  aria-hidden="true"
                ></span>
              {/if}
              <span
                class="absolute overflow-hidden"
                style="left: {seat.spriteX}px; top: {seat.spriteY}px; {seat.cropRows ? `height: ${seat.cropRows * MAP_SCALE}px` : ''}"
              >
                <AgentSprite state={seat.state} seed={seat.id} projectColor={seat.projectColor} scale={MAP_SCALE} facing={seat.facing} />
              </span>
              <span
                class="absolute -translate-x-1/2 flex items-center gap-1.5 max-w-32 px-1.5 py-0.5 bg-card border border-border text-caption leading-3.5 text-foreground whitespace-nowrap"
                style="left: {seat.tagX}px; top: {seat.tagY}px"
              >
                <span class="truncate">{seat.name}</span>
              </span>
              {#if seat.callout}
                <span
                  class="absolute -translate-x-1/2 flex items-center gap-1.5 px-1.5 py-px bg-card border text-caption leading-3.5 whitespace-nowrap
                    {seat.callout === 'error' ? 'border-status-error text-status-error' : 'border-status-attention text-status-attention'}"
                  style="left: {seat.tagX}px; top: {seat.calloutY}px"
                >
                  <Pulse tone={seat.callout} size="xs" motion={seat.callout === 'error' ? 'none' : 'pulse'} />
                  {seat.callout === 'error' ? 'Error' : 'Needs you'}
                </span>
              {/if}
            </button>
          {/each}
        </section>
      {/each}

      <!-- Lamp light and fireflies over everything; neither takes a click. -->
      {#each map.glows as g, i (i)}
        <span class="glow absolute pointer-events-none" style="left: {g.x - g.size / 2}px; top: {g.y - g.size / 2}px; width: {g.size}px; height: {g.size}px" aria-hidden="true"></span>
      {/each}
      {#each map.flies as f, i (i)}
        <span class="firefly absolute pointer-events-none" style="left: {f.x}px; top: {f.y}px; animation-delay: {f.delay}s" aria-hidden="true"></span>
      {/each}
      <span class="vignette absolute inset-0 pointer-events-none" aria-hidden="true"></span>
    </div>
  </div>
</div>

<style>
  /* The map is night in both themes: the grove at night. */
  .map-viewport {
    background: #0e140e;
    cursor: grab;
  }
  .map-viewport:active {
    cursor: grabbing;
  }
  .map-scenery {
    image-rendering: pixelated;
  }
  .room-sign {
    background: #3f3025;
    border: 2px solid #8a6a4a;
    box-shadow: 0 4px 0 #241c15;
    color: #f6f5f2;
  }
  .room-sign-count {
    color: #e6e1d6;
  }
  .screen {
    border: 1px solid #57534e;
  }
  .screen-off {
    background: #262c33;
  }
  .glow {
    mix-blend-mode: screen;
    background: radial-gradient(closest-side, rgb(255 214 150 / 0.15), rgb(255 214 150 / 0.05) 50%, rgb(255 214 150 / 0) 100%);
  }
  .firefly {
    width: 4px;
    height: 4px;
    background: #e8e2a0;
    animation: firefly-glow 3.2s ease-in-out infinite;
  }
  @keyframes firefly-glow {
    0%, 100% { opacity: 0.1; }
    50% { opacity: 0.9; }
  }
  .vignette {
    box-shadow: inset 0 0 180px 30px rgb(0 0 0 / 0.5);
  }
  @media (prefers-reduced-motion: reduce) {
    .firefly {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
