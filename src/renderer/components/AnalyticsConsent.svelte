<script lang="ts">
  import { settingsStore } from '../stores/settings.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let { visible = false }: { visible: boolean } = $props();
  let show = $state(false);

  $effect(() => {
    show = visible;
  });

  // Only the answer is saved: save() would also write whatever the Settings
  // panel's draft holds, including edits closed without saving. The banner
  // goes either way; a failed save says so rather than leaving a button that
  // seems to do nothing.
  async function answer(patch: { analyticsEnabled?: boolean; analyticsPrompted: true }) {
    show = false;
    try {
      await settingsStore.updateNow(patch);
    } catch (e) {
      const why = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
      store.setError(`Couldn't save your usage data choice (${why}). You'll be asked again next time.`);
    }
  }

  const handleAccept = () => answer({ analyticsEnabled: true, analyticsPrompted: true });
  const handleDecline = () => answer({ analyticsPrompted: true });
</script>

<!-- A row of its own at the bottom of the window (App places it), not an
     overlay: floating, it covered the sidebar's + Project and Settings
     buttons, which Getting Started tells a new user to click, and sat over
     dialogs such as Help. -->
{#if show}
  <div class="shrink-0 border-t border-border bg-card" role="region" aria-label="Usage data">
    <div class="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
      <p class="text-xs text-muted-foreground">
        Help improve Grove Bench by sending anonymous usage data. No personal information or code content is collected.
        You can change this anytime in Settings → Privacy (Hedges).
      </p>
      <div class="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onclick={handleDecline}>Decline</Button>
        <Button size="sm" onclick={handleAccept}>Accept</Button>
      </div>
    </div>
  </div>
{/if}
