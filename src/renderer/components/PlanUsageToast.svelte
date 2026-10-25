<script lang="ts">
  /** The plan usage alert in the app (stores/planAlerts), built like the
   *  memory toast: a warning Notice on a floating panel. */
  import { fly } from 'svelte/transition';
  import { planAlertStore } from '../stores/planAlerts.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  // Long enough to be read after looking away; it is once per window.
  $effect(() => {
    if (planAlertStore.alert) {
      const timer = setTimeout(() => planAlertStore.dismiss(), 15_000);
      return () => clearTimeout(timer);
    }
  });

  const alert = $derived(planAlertStore.alert);
  const title = $derived(alert?.windows.map((w) => `${w.label} usage at ${w.percent}%`).join(', ') ?? '');
  // The agent, then when each window resets (named when there are several).
  const detail = $derived.by(() => {
    if (!alert) return '';
    const resets = alert.windows
      .filter((w) => w.resetsAt)
      .map((w) => `${alert.windows.length > 1 ? `${w.label} resets` : 'resets'} ${formatResetTime(w.resetsAt!)}`);
    return [agentsStore.get(alert.providerId)?.displayName ?? 'Your agent', ...resets].join(' · ');
  });

  function openSettings() {
    planAlertStore.dismiss();
    settingsStore.openAt('limits');
  }
</script>

{#if alert}
  <div transition:fly={{ y: 8, duration: 140 }} data-testid="plan-usage-toast">
    <div class="bg-popover border border-border shadow-xl">
      <Notice tone="warning" {title}>
        {#snippet actions()}
          <Button size="2xs" variant="link" onclick={() => planAlertStore.viewUsage()}>View usage</Button>
          <Button size="2xs" variant="quiet" onclick={openSettings}>Alert level</Button>
          <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => planAlertStore.dismiss()}>
            <XIcon />
          </Button>
        {/snippet}
        <p class="text-muted-foreground">{detail}</p>
      </Notice>
    </div>
  </div>
{/if}
