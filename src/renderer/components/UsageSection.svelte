<script lang="ts">
  /**
   * Plan usage ("runway") for one agent: how much of each plan window is used
   * and when it resets. Shared by a running conversation's Agent settings and
   * a draft's, which has no session to fetch through, so it shows the last
   * figures the agent reported, saved across conversations and launches.
   */
  import { usageStore } from '../stores/usage.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  // The same scale as the context meter, so the two read alike.
  import { usageTextClass, usageBarClass } from '../lib/usage-tone.js';
  import { usageUpdatedAt, windowHasReset } from '../../shared/usage.js';
  import PixelMeter from './PixelMeter.svelte';

  /** Figures older than this say when they were last updated. */
  const STALE_MS = 10 * 60 * 1000;

  let { providerId, agentName }: { providerId: string; agentName: string } = $props();

  let usage = $derived(usageStore.get(providerId));
  let loading = $derived(usageStore.loading[providerId] ?? false);
  let reports = $derived(agentsStore.supports(providerId, 'usage'));
  let updatedAt = $derived(usage ? usageUpdatedAt(usage) : 0);
  let stale = $derived(updatedAt > 0 && Date.now() - updatedAt > STALE_MS);

  $effect(() => {
    agentsStore.load();
    if (providerId) usageStore.loadCached(providerId);
  });

  function clock(ms: number): string {
    const d = new Date(ms);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return Date.now() - ms >= 24 * 3600 * 1000
      ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
      : time;
  }
</script>

<div class="mt-3 pt-2 border-t border-border/60" data-testid="usage">
  <div class="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
    <span>Usage</span>
    {#if usage?.plan}<span class="normal-case tracking-normal text-muted-foreground/40">{usage.plan} plan</span>{/if}
  </div>
  {#if !reports}
    <div class="py-1 text-muted-foreground/50">{agentName} doesn't report plan usage.</div>
  {:else if usage && usage.available && usage.windows.length > 0}
    {#each usage.windows as w (w.id)}
      {@const reset = windowHasReset(w)}
      <div
        class="py-1"
        title={w.resetsAt ? `Resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : undefined}
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-muted-foreground">{w.label}</span>
          {#if reset}
            <span class="text-muted-foreground/60">reset</span>
          {:else}
            <span class="font-medium {usageTextClass(w.utilization * 100)}">{Math.round(w.utilization * 100)}%</span>
          {/if}
        </div>
        <!-- Pixel blocks of 5%, like the context meter in the status bar. -->
        <PixelMeter
          percent={reset ? 0 : Math.min(100, w.utilization * 100)}
          cells={20}
          fillClass={usageBarClass(w.utilization * 100)}
          class="h-1.5 mt-1"
          data-testid="usage-bar-{w.id}"
        />
        {#if w.resetsAt && !reset}
          <div class="text-[10px] text-muted-foreground/60 mt-0.5">resets {formatResetTime(w.resetsAt)}</div>
        {/if}
      </div>
    {/each}
    {#if stale}
      <div class="text-[10px] text-muted-foreground/50 mt-1" data-testid="usage-updated">Last updated {clock(updatedAt)}</div>
    {/if}
  {:else if usage && !usage.available}
    <div class="py-1 text-muted-foreground/50">Plan usage isn't reported for this sign-in (API key or third-party provider).</div>
  {:else if loading}
    <div class="py-1 text-muted-foreground/50">Loading usage…</div>
  {:else}
    <div class="py-1 text-muted-foreground/50">No usage reported yet. Available once the agent has connected.</div>
  {/if}
</div>
