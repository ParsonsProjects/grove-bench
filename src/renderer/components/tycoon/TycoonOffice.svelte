<script lang="ts">
  import { store } from '../../stores/sessions.svelte.js';
  import { messageStore } from '../../stores/messages.svelte.js';
  import TycoonDesk from './TycoonDesk.svelte';
  import TycoonMoodBubble from './TycoonMoodBubble.svelte';
  import { developerAppearance, buildSprite, SPRITE_COLS, SPRITE_ROWS } from '../../lib/tycoon-appearance.js';
  import { iso, roomLayout, WALL_H } from '../../lib/tycoon-iso.js';
  import { sessionMood, moodLabel } from '../../lib/tycoon-mood.js';

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

  /** The room grows and upgrades with the number of developers. */
  let layout = $derived(roomLayout(liveSessions.length));

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

  // ─── Scene geometry ───
  function p(x: number, y: number, dy = 0): string {
    const q = iso(x, y);
    return `${q.x},${q.y + dy}`;
  }

  let leftWall = $derived(`${p(0, 0, -WALL_H)} ${p(0, layout.rows, -WALL_H)} ${p(0, layout.rows)} ${p(0, 0)}`);
  let rightWall = $derived(`${p(0, 0, -WALL_H)} ${p(layout.cols, 0, -WALL_H)} ${p(layout.cols, 0)} ${p(0, 0)}`);
  let leftTrim = $derived(`${p(0, 0, -7)} ${p(0, layout.rows, -7)} ${p(0, layout.rows)} ${p(0, 0)}`);
  let rightTrim = $derived(`${p(0, 0, -7)} ${p(layout.cols, 0, -7)} ${p(layout.cols, 0)} ${p(0, 0)}`);

  /** Window quads along a wall edge (t runs along the wall in tiles). */
  function windowsAlong(length: number): number[] {
    const out: number[] = [];
    for (let t = 1.4; t + 1.6 <= length - 1; t += 3) out.push(t);
    return out;
  }
  let leftWindows = $derived(windowsAlong(layout.rows));
  let rightWindows = $derived(windowsAlong(layout.cols));

  function leftWindowQuad(t: number): string {
    return `${p(0, t, -74)} ${p(0, t + 1.6, -74)} ${p(0, t + 1.6, -36)} ${p(0, t, -36)}`;
  }
  function rightWindowQuad(t: number): string {
    return `${p(t, 0, -74)} ${p(t + 1.6, 0, -74)} ${p(t + 1.6, 0, -36)} ${p(t, 0, -36)}`;
  }

  // Studio name painted on the left wall (iso plane: x-advance follows the
  // wall's +y edge direction, vertical stays vertical).
  let wallTextAnchor = $derived(iso(0, layout.rows * 0.72));

  // Plant decor in the right corner
  let plantBase = $derived(iso(layout.cols - 1.4, 1.1));
</script>

<div class="office relative h-full overflow-hidden">
  <svg
    viewBox="{layout.viewBox.x} {layout.viewBox.y} {layout.viewBox.w} {layout.viewBox.h}"
    preserveAspectRatio="xMidYMid meet"
    class="w-full h-full block"
    onclick={() => selectedId = null}
    role="presentation"
  >
    <!-- walls -->
    <polygon points={leftWall} fill={layout.tier.wallLeft} />
    <polygon points={rightWall} fill={layout.tier.wallRight} />
    <polygon points={leftTrim} fill={layout.tier.trim} />
    <polygon points={rightTrim} fill={layout.tier.trim} />

    <!-- windows -->
    {#each leftWindows as t (t)}
      <polygon points={leftWindowQuad(t)} fill="#cfe6f2" stroke="#f2f2ee" stroke-width="2" opacity="0.9" />
    {/each}
    {#each rightWindows as t (t)}
      <polygon points={rightWindowQuad(t)} fill="#d8ecdf" stroke="#f2f2ee" stroke-width="2" opacity="0.9" />
    {/each}

    <!-- studio name on the left wall -->
    <text
      transform="matrix(0.894 -0.447 0 1 {wallTextAnchor.x + 3} {wallTextAnchor.y - 34})"
      class="wall-text"
    >{layout.tier.name}</text>

    <!-- floor -->
    {#each { length: layout.cols } as _, fx}
      {#each { length: layout.rows } as _, fy}
        <polygon
          points={`${p(fx, fy)} ${p(fx + 1, fy)} ${p(fx + 1, fy + 1)} ${p(fx, fy + 1)}`}
          fill={(fx + fy) % 2 === 0 ? layout.tier.floorA : layout.tier.floorB}
        />
      {/each}
    {/each}

    <!-- plant decor -->
    {#if layout.tier.decor}
      <g>
        <polygon points={`${plantBase.x - 7},${plantBase.y - 14} ${plantBase.x + 7},${plantBase.y - 14} ${plantBase.x + 5},${plantBase.y} ${plantBase.x - 5},${plantBase.y}`} fill="#a4552f" />
        <polygon points={`${plantBase.x},${plantBase.y - 44} ${plantBase.x + 12},${plantBase.y - 26} ${plantBase.x},${plantBase.y - 12} ${plantBase.x - 12},${plantBase.y - 26}`} fill="#3f8f4a" />
        <polygon points={`${plantBase.x - 10},${plantBase.y - 36} ${plantBase.x},${plantBase.y - 26} ${plantBase.x - 4},${plantBase.y - 16}`} fill="#4aa858" />
        <polygon points={`${plantBase.x + 10},${plantBase.y - 36} ${plantBase.x},${plantBase.y - 26} ${plantBase.x + 4},${plantBase.y - 16}`} fill="#357a40" />
      </g>
    {/if}

    <!-- desks, in row-major order (back rows first = painter's algorithm) -->
    {#each liveSessions as session, i (session.id)}
      <TycoonDesk
        {session}
        tx={layout.desks[i].x}
        ty={layout.desks[i].y}
        selected={selectedId === session.id}
        onselect={(id) => selectedId = id}
        onopen={onopendesk}
      />
    {/each}

    <!-- status bubbles in a top layer so desks in front never cover them -->
    {#each liveSessions as session, i (session.id)}
      <TycoonMoodBubble {session} tx={layout.desks[i].x} ty={layout.desks[i].y} />
    {/each}
  </svg>

  <!-- HUD: tier + headcount -->
  <div class="absolute top-2 left-3 flex items-center gap-2 pointer-events-none">
    <span class="hud-chip">{layout.tier.name}</span>
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

  .wall-text {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    fill: rgb(255 255 255 / 0.65);
  }
</style>
