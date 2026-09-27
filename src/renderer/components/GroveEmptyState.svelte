<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AgentSprite from './AgentSprite.svelte';
  import { agentSpriteState, toRuns, BENCH, LAMP, SCENERY_PALETTE } from '../lib/agent-sprite.js';
  import { PIXEL_TREE } from '../lib/pixel-tree.js';

  /**
   * Grove character versions of the main area's empty states.
   * - `empty`: no conversations at all. An empty bench under the tree.
   * - `pick`: conversations exist but none is open. Each agent sits on its
   *   bench showing its status; clicking one opens that conversation.
   */
  let { variant }: { variant: 'empty' | 'pick' } = $props();

  const MAX_PICKS = 6;
  const bench = toRuns(BENCH, SCENERY_PALETTE);
  const lamp = toRuns(LAMP, SCENERY_PALETTE);

  let picks = $derived(
    [...store.sessions]
      .filter((s) => !s.completedAt)
      .sort((a, b) => (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0))
      .slice(0, MAX_PICKS),
  );

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

{#if variant === 'empty'}
  <div class="relative z-10 flex flex-col items-center text-center">
    <!-- 56x30 art pixels at 4x: the logo tree, an empty bench and an unlit lamp. -->
    <svg width="224" height="120" viewBox="0 0 56 30" shape-rendering="crispEdges" aria-hidden="true">
      <g transform="translate(6 5)">
        {#each PIXEL_TREE as p (`${p.x},${p.y}`)}
          <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
        {/each}
      </g>
      <g transform="translate(29 24)">
        {#each bench as r (`${r.x},${r.y}`)}
          <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
        {/each}
      </g>
      <g transform="translate(46 18)">
        {#each lamp as r (`${r.x},${r.y}`)}
          <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
        {/each}
      </g>
      <rect x="0" y="29" width="56" height="1" fill="#3a9a48" opacity="0.45" />
    </svg>
    <p class="text-sm mt-5 mb-2 text-foreground/80">No conversations yet</p>
    <p class="text-xs text-muted-foreground">
      Add a project, then press <span class="text-foreground">+ Conversation</span>. An agent will take the bench.
    </p>
  </div>
{:else}
  <div class="relative z-10 flex flex-col items-center text-center px-6">
    <p class="text-sm mb-6 text-foreground/80">Pick a conversation</p>
    <div class="flex flex-wrap justify-center gap-x-6 gap-y-5 max-w-4xl">
      {#each picks as s (s.id)}
        {@const name = s.displayName || s.branch}
        <button type="button" class="pick flex flex-col items-center gap-2 p-2 w-28" onclick={() => open(s.id)} title={name}>
          <span class="seat relative flex justify-center">
            <!-- The bench sits behind the agent's legs. -->
            <svg class="absolute bottom-0" width="36" height="15" viewBox="0 0 12 5" shape-rendering="crispEdges" aria-hidden="true">
              {#each bench as r (`${r.x},${r.y}`)}
                <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
              {/each}
            </svg>
            <span class="relative -mb-1.5 ml-3">
              <AgentSprite state={stateFor(s)} scale={3} />
            </span>
          </span>
          <span class="text-xs text-muted-foreground truncate max-w-full">{name}</span>
        </button>
      {/each}
    </div>
    <p class="text-xs text-muted-foreground mt-6">Or choose one from the sidebar.</p>
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
