<script lang="ts">
  /** The plan usage alert in the app (stores/planAlerts). */
  import { fly } from 'svelte/transition';
  import { planAlertStore } from '../stores/planAlerts.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';

  // Long enough to be read after looking away; it is once per window.
  $effect(() => {
    if (planAlertStore.alert) {
      const timer = setTimeout(() => planAlertStore.dismiss(), 15_000);
      return () => clearTimeout(timer);
    }
  });

  function openSettings() {
    planAlertStore.dismiss();
    settingsStore.openAt('limits');
  }
</script>

{#if planAlertStore.alert}
  {@const alert = planAlertStore.alert}
  <div class="fixed bottom-28 right-4 z-50 max-w-md" transition:fly={{ y: 8, duration: 140 }} role="status" data-testid="plan-usage-toast">
    <div class="border border-amber-400 bg-popover p-3 shadow-xl backdrop-blur-sm flex items-start gap-3">
      <span class="shrink-0 mt-0.5 text-amber-400">!</span>
      <p class="text-sm flex-1 text-foreground">
        {agentsStore.get(alert.providerId)?.displayName ?? 'Your agent'} plan usage: {alert.text}.
      </p>
      <button onclick={openSettings} class="text-sm shrink-0 text-primary underline-offset-2 hover:underline">Alert level</button>
      <button onclick={() => planAlertStore.dismiss()} class="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
        &times;
      </button>
    </div>
  </div>
{/if}
