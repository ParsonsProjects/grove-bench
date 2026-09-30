<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AgentSprite from './AgentSprite.svelte';
  import FirstSteps from './FirstSteps.svelte';
  import { sessionRepoColor } from '../lib/session-repo-color.js';
  import {
    agentSpriteState, toRuns, BENCH, LAMP, WATERING_CAN, SPROUT, FLAG, EASEL, SCENERY_PALETTE, SPRITE_H,
    type AgentSpriteState, type GroveTab,
  } from '../lib/agent-sprite.js';
  import { PIXEL_TREE } from '../lib/pixel-tree.js';

  /**
   * Grove character versions of the main area's empty states.
   * - `empty`: no conversations at all. An empty bench under the tree.
   * - `pick`: conversations exist but none is open. Each agent in the
   *   sidebar's Conversations list sits on its bench showing its status;
   *   clicking one opens that conversation.
   * - `draft`: a new conversation that hasn't started. The empty bench, with
   *   the caller's text underneath.
   * - `agent`: one conversation's agent on the bench, looking as it does in
   *   the sidebar (same state, skin, hair and laptop logo), with the caller's
   *   text underneath.
   * With `tab`, the scene sits in that workspace tab and the lamp gives way
   * to the tab's own props: a watering can by a sprout in Changes, a flag in
   * Checkpoints, an easel with a web page in Preview.
   */
  import type { Snippet } from 'svelte';
  let { variant, agent = null, tab = null, children }: {
    variant: 'empty' | 'pick' | 'draft' | 'agent';
    agent?: { seed: string; state: AgentSpriteState; projectColor?: string | null } | null;
    tab?: GroveTab | null;
    children?: Snippet;
  } = $props();

  const bench = toRuns(BENCH, SCENERY_PALETTE);

  // The scene, in art pixels at 4x. The bench stands on the ground; a seated
  // agent's body (columns 0 to 5) is centred on it, feet on the ground, so
  // its laptop rests at seat height and a symbol floats to its right.
  const SCALE = 4;
  const GROUND_Y = 29;
  const BENCH_X = 29;
  const BENCH_Y = GROUND_Y - BENCH.length;
  const SEAT_X = BENCH_X + (BENCH[0].length - 6) / 2;
  const SEAT_Y = GROUND_Y - SPRITE_H;

  // What stands right of the bench, each piece on the ground.
  const PROPS: Record<GroveTab | 'none', { name: string; map: string[]; x: number }[]> = {
    none: [{ name: 'lamp', map: LAMP, x: 46 }],
    changes: [{ name: 'sprout', map: SPROUT, x: 43 }, { name: 'watering-can', map: WATERING_CAN, x: 47 }],
    checkpoints: [{ name: 'flag', map: FLAG, x: 45 }],
    preview: [{ name: 'easel', map: EASEL, x: 44 }],
  };
  let props = $derived(
    PROPS[tab ?? 'none'].map((p) => ({ name: p.name, x: p.x, y: GROUND_Y - p.map.length, runs: toRuns(p.map, SCENERY_PALETTE) })),
  );

  // Same list, same order as the sidebar's Conversations section (its triage
  // filter aside), so the landing never shows a conversation the sidebar doesn't.
  let picks = $derived(store.openConversations);

  function stateFor(s: (typeof store.sessions)[number]) {
    return agentSpriteState({
      destroying: false,
      status: s.status,
      hasPending: messageStore.needsInput(s.id),
      isRunning: messageStore.getIsRunning(s.id),
      needsAttention: !!store.needsAttention[s.id],
    });
  }

  function open(id: string) {
    store.activeSessionId = id;
    store.clearNeedsAttention(id);
  }
</script>

{#if variant === 'empty' || variant === 'draft' || variant === 'agent'}
  <div class="relative z-10 flex flex-col items-center text-center">
    <div class="relative">
    <!-- 56x30 art pixels at 4x: the logo tree, a bench and an unlit lamp
         (or the tab's own props). -->
    <svg width="224" height="120" viewBox="0 0 56 30" shape-rendering="crispEdges" aria-hidden="true">
      <g transform="translate(6 5)">
        {#each PIXEL_TREE as p (`${p.x},${p.y}`)}
          <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
        {/each}
      </g>
      <g transform="translate({BENCH_X} {BENCH_Y})">
        {#each bench as r (`${r.x},${r.y}`)}
          <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
        {/each}
      </g>
      {#each props as p (p.name)}
        <g transform="translate({p.x} {p.y})" data-scenery={p.name}>
          {#each p.runs as r (`${r.x},${r.y}`)}
            <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
          {/each}
        </g>
      {/each}
      <rect x="0" y={GROUND_Y} width="56" height="1" fill="#3a9a48" opacity="0.45" />
    </svg>
    {#if variant === 'agent' && agent}
      <!-- In front of the bench, so the bench sits behind its legs. -->
      <span class="absolute leading-none" style="left: {SEAT_X * SCALE}px; top: {SEAT_Y * SCALE}px">
        <AgentSprite state={agent.state} seed={agent.seed} projectColor={agent.projectColor ?? null} scale={SCALE} />
      </span>
    {/if}
    </div>
    {#if variant === 'draft' || variant === 'agent'}
      {@render children?.()}
    {:else}
      <div class="mt-5 flex flex-col items-center">
        <FirstSteps />
      </div>
    {/if}
  </div>
{:else}
  <div class="relative z-10 flex flex-col items-center text-center px-6 py-6 max-h-full overflow-y-auto">
    {#if picks.length === 0}
      <p class="text-sm mb-2 text-foreground/80">No open conversations</p>
      <p class="text-xs text-muted-foreground">Pick one under Projects in the sidebar to open it again.</p>
    {:else}
      <p class="text-sm mb-6 text-foreground/80">Pick a conversation</p>
      <div class="flex flex-wrap justify-center gap-x-6 gap-y-5 max-w-4xl">
        {#each picks as s (s.id)}
          {@const name = s.displayName || s.branch || 'New conversation'}
          <button type="button" class="pick flex flex-col items-center gap-2 p-2 w-28" onclick={() => open(s.id)} title={name}>
            <span class="seat relative flex justify-center">
              <!-- The bench sits behind the agent's legs. -->
              <svg class="absolute bottom-0" width="36" height="15" viewBox="0 0 12 5" shape-rendering="crispEdges" aria-hidden="true">
                {#each bench as r (`${r.x},${r.y}`)}
                  <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
                {/each}
              </svg>
              <span class="relative -mb-1.5 ml-3">
                <AgentSprite state={stateFor(s)} seed={s.id} projectColor={sessionRepoColor(s.id)} scale={3} />
              </span>
            </span>
            <span class="text-xs text-muted-foreground truncate max-w-full">{name}</span>
          </button>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground mt-6">Or choose one from the sidebar.</p>
    {/if}
  </div>
{/if}

<style>
  .pick {
    transition: background-color 0.15s ease;
  }
  .pick:hover {
    background-color: color-mix(in oklch, var(--accent) 40%, transparent);
  }
  .pick:hover span:last-child {
    color: var(--foreground);
  }
  .pick:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .seat {
    width: 36px;
    height: 30px;
  }
</style>
