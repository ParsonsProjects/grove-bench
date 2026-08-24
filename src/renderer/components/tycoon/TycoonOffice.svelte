<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../../stores/sessions.svelte.js';
  import { messageStore } from '../../stores/messages.svelte.js';
  import { developerAppearance, buildSprite, SPRITE_COLS, SPRITE_ROWS } from '../../lib/tycoon-appearance.js';
  import { roomLayout } from '../../lib/tycoon-iso.js';
  import { sessionMood, moodLabel } from '../../lib/tycoon-mood.js';
  import { TycoonScene, type DeskInput } from '../../lib/tycoon-scene.js';

  interface Props {
    onopendesk: (id: string) => void;
  }

  let { onopendesk }: Props = $props();

  /** Live sessions in stable creation order so desks never shuffle around. */
  let liveSessions = $derived(
    store.sessions
      .filter((s) => s.status !== 'stopped')
      .toSorted((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id)),
  );

  let tierName = $derived(roomLayout(liveSessions.length).tier.name);

  /** Same mutually-exclusive categories as the sidebar's ACTIVE header. */
  let stats = $derived.by(() => {
    let working = 0, idle = 0, waiting = 0;
    for (const s of liveSessions) {
      if (messageStore.hasPendingPermission(s.id)) waiting++;
      else if (messageStore.getIsRunning(s.id)) working++;
      else idle++;
    }
    return { working, idle, waiting };
  });

  // ─── RTS-style selection ───
  let selectedId = $state<string | null>(null);
  let selected = $derived(liveSessions.find((s) => s.id === selectedId) ?? null);
  let selectedMood = $derived(selected ? moodLabel(sessionMood(selected)) : '');
  let selectedSprite = $derived(selected ? buildSprite(developerAppearance(selected.id)) : []);

  /** Stop the selected agent (same semantics as the sidebar's stop button,
   *  except the active session is cleared rather than switched so another
   *  desk's bubble doesn't pop open). */
  async function stopSelected() {
    if (!selected) return;
    const id = selected.id;
    store.pushRecentlyClosed(id);
    if (store.activeSessionId === id) {
      store.activeSessionId = null;
    }
    store.updateStatus(id, 'stopped');
    selectedId = null;
    try {
      await window.groveBench.stopSession(id);
    } catch { /* session may already be dead */ }
  }

  // ─── PixiJS scene ───
  let host = $state<HTMLDivElement>();
  let scene = $state<TycoonScene | null>(null);

  /** Declarative desk state consumed by the scene; recomputed on any store change. */
  let deskInputs = $derived.by((): DeskInput[] => {
    const layout = roomLayout(liveSessions.length);
    return liveSessions.map((s, i) => ({
      id: s.id,
      tx: layout.desks[i].x,
      ty: layout.desks[i].y,
      label: s.displayName || s.branch,
      mood: sessionMood(s),
      selected: selectedId === s.id,
    }));
  });

  onMount(() => {
    const sc = new TycoonScene({
      onselect: (id) => selectedId = id,
      onopen: (id) => onopendesk(id),
    });
    scene = sc;
    sc.init(host!).catch((e) => console.error('Tycoon scene failed to start:', e));
    return () => {
      sc.destroy();
      scene = null;
    };
  });

  $effect(() => {
    scene?.sync(deskInputs.length, deskInputs);
  });
</script>

<div class="office relative h-full overflow-hidden">
  <div bind:this={host} class="absolute inset-0"></div>

  <!-- HUD: tier + headcount -->
  <div class="absolute top-2 left-3 flex items-center gap-2 pointer-events-none">
    <span class="hud-chip">{tierName}</span>
    <span class="hud-chip text-muted-foreground">{liveSessions.length} {liveSessions.length === 1 ? 'dev' : 'devs'}</span>
  </div>

  <!-- HUD: status counters -->
  <div class="absolute top-2 right-3 flex items-center gap-1.5 pointer-events-none">
    {#if stats.working}<span class="hud-chip flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-primary"></span>{stats.working} working</span>{/if}
    {#if stats.waiting}<span class="hud-chip flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-amber-500"></span>{stats.waiting} waiting</span>{/if}
    {#if stats.idle}<span class="hud-chip flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-green-500"></span>{stats.idle} idle</span>{/if}
  </div>

  {#if liveSessions.length === 0}
    <div class="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none">
      <div class="hud-chip text-center">
        <p class="text-sm mb-0.5 text-foreground">The garage is empty.</p>
        <p class="text-xs text-muted-foreground">Hire a developer with “+ Agent” in the sidebar.</p>
      </div>
    </div>
  {/if}

  <!-- RTS command panel for the selected developer -->
  {#if selected}
    <div class="absolute inset-x-0 bottom-3 flex justify-center">
      <div class="flex items-center gap-3 bg-card/95 border-2 border-border px-3 py-2 shadow-lg">
        <svg viewBox="0 0 {SPRITE_COLS} {SPRITE_ROWS}" class="w-11 h-10 shrink-0 bg-background border border-border p-0.5" shape-rendering="crispEdges">
          {#each selectedSprite as px ((px.x << 8) | px.y)}
            <rect x={px.x} y={px.y} width="1" height="1" fill={px.color} />
          {/each}
        </svg>
        <div class="min-w-0 max-w-64">
          <div class="text-sm text-foreground truncate">{selected.displayName || selected.branch}</div>
          <div class="text-[11px] text-muted-foreground truncate">
            {store.repoDisplayName(selected.repoPath)} · {selectedMood}
          </div>
        </div>
        <div class="flex items-center gap-1.5 pl-1">
          <button
            type="button"
            class="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/85 transition-colors"
            onclick={() => selected && onopendesk(selected.id)}
          >
            Open
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-destructive hover:border-destructive/60 transition-colors"
            onclick={stopSelected}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .office {
    /* Deep backdrop behind the room, GDT-style */
    background:
      radial-gradient(ellipse at 50% 35%, oklch(0.30 0.02 250 / 0.8), transparent 70%),
      oklch(0.19 0.012 255);
  }

  .hud-chip {
    display: inline-block;
    padding: 0.25rem 0.6rem;
    background: var(--card);
    border: 1px solid var(--border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--foreground);
  }
</style>
