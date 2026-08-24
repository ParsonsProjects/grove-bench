<script lang="ts">
  import { store } from '../../stores/sessions.svelte.js';
  import { messageStore } from '../../stores/messages.svelte.js';
  import TycoonDesk from './TycoonDesk.svelte';

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
</script>

<div class="office h-full flex flex-col overflow-hidden">
  <!-- Back wall -->
  <div class="wall shrink-0 flex items-end justify-between px-4 pb-1">
    <span class="text-[10px] uppercase tracking-widest text-muted-foreground/70">
      Dev Office — {liveSessions.length} {liveSessions.length === 1 ? 'developer' : 'developers'}
    </span>
    <span class="flex items-center gap-3 text-[10px] text-muted-foreground/70">
      {#if stats.working}<span class="flex items-center gap-1" title="{stats.working} working"><span class="w-1.5 h-1.5 bg-primary"></span>{stats.working} working</span>{/if}
      {#if stats.waiting}<span class="flex items-center gap-1" title="{stats.waiting} waiting for input"><span class="w-1.5 h-1.5 bg-amber-500"></span>{stats.waiting} waiting</span>{/if}
      {#if stats.idle}<span class="flex items-center gap-1" title="{stats.idle} idle"><span class="w-1.5 h-1.5 bg-green-500"></span>{stats.idle} idle</span>{/if}
    </span>
  </div>

  <!-- Office floor -->
  <div class="floor flex-1 overflow-auto">
    {#if liveSessions.length === 0}
      <div class="h-full flex items-center justify-center">
        <div class="text-center text-muted-foreground">
          <p class="text-sm mb-1">The office is empty.</p>
          <p class="text-xs">Hire a developer with “+ Agent” in the sidebar.</p>
        </div>
      </div>
    {:else}
      <div class="flex flex-wrap content-start justify-center gap-x-6 gap-y-8 px-6 py-8">
        {#each liveSessions as session (session.id)}
          <TycoonDesk {session} onopen={onopendesk} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .wall {
    height: 2.25rem;
    background: oklch(0.24 0.005 260);
    border-bottom: 3px solid oklch(0.30 0.01 260);
  }

  /* Pixel checkerboard carpet */
  .floor {
    background-color: oklch(0.225 0.006 250);
    background-image:
      repeating-linear-gradient(
        0deg,
        transparent 0 24px,
        oklch(1 0 0 / 0.015) 24px 48px
      ),
      repeating-linear-gradient(
        90deg,
        transparent 0 24px,
        oklch(1 0 0 / 0.015) 24px 48px
      );
  }
</style>
