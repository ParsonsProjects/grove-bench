<script lang="ts">
  import { settingsStore } from '../stores/settings.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let { visible = false }: { visible: boolean } = $props();
  let show = $state(false);

  $effect(() => {
    show = visible;
  });

  async function handleAccept() {
    settingsStore.draft.analyticsEnabled = true;
    settingsStore.draft.analyticsPrompted = true;
    await settingsStore.save();
    show = false;
  }

  async function handleDecline() {
    settingsStore.draft.analyticsPrompted = true;
    await settingsStore.save();
    show = false;
  }
</script>

{#if show}
  <div class="fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-card/95 backdrop-blur-sm">
    <div class="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
      <p class="text-xs text-muted-foreground">
        Help improve Grove Bench by sending anonymous usage data. No personal information or code content is collected.
        You can change this anytime in Settings.
      </p>
      <div class="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onclick={handleDecline}>Decline</Button>
        <Button size="sm" onclick={handleAccept}>Accept</Button>
      </div>
    </div>
  </div>
{/if}
