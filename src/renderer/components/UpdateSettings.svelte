<script lang="ts">
  import type { UpdateState, UpdateStatus } from '../../shared/types.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { releaseNotesUrl } from '../lib/release-notes.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import CheckboxSetting from './settings/CheckboxSetting.svelte';

  let updateState = $state<UpdateState | null>(null);
  let checking = $state(false);

  $effect(() => {
    const unsub = window.groveBench.onUpdateStatus((s: UpdateStatus) => {
      if (updateState) updateState = { ...updateState, status: s };
    });
    window.groveBench.getUpdateState()
      .then((s) => { updateState = s; })
      .catch(() => {});
    return unsub;
  });

  async function check() {
    checking = true;
    try {
      const s = await window.groveBench.checkForUpdate();
      if (updateState && s) updateState = { ...updateState, status: s };
    } catch {
      // The status event carries any failure.
    } finally {
      checking = false;
    }
  }

  function describe(status: UpdateStatus | null): string {
    switch (status?.state) {
      case 'checking': return 'Checking...';
      case 'not-available': return "You're up to date.";
      case 'available': return `Version ${status.info.version} is available.`;
      case 'downloading': return `Downloading version ${status.info.version} (${Math.round(status.percent)}%).`;
      case 'downloaded': return `Version ${status.info.version} is ready. Restart from the title bar to install it, or it installs when you next quit.`;
      case 'error': return status.during === 'download'
        ? `The download failed: ${status.message}`
        : `Couldn't check for updates: ${status.message}`;
      default: return '';
    }
  }
</script>

<!-- Shown under an "Updates" heading in Settings → The grove (General). -->
<div data-setting="updates" class="flex flex-col gap-2">
  {#if updateState}
    <p class="text-xs text-muted-foreground leading-relaxed">
      Version {updateState.currentVersion}.
      <button
        type="button"
        class="text-primary hover:underline"
        onclick={() => window.groveBench.openExternal(releaseNotesUrl())}
      >All releases</button>
    </p>
    {#if updateState.enabled}
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" onclick={check} disabled={checking}>Check for updates</Button>
        <span class="text-xs text-muted-foreground" aria-live="polite">
          {checking ? 'Checking...' : describe(updateState.status)}
        </span>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">Updates are only checked in the installed app.</p>
    {/if}
  {/if}
</div>
<CheckboxSetting
  setting="auto-download-updates"
  label="Download updates automatically"
  description="New versions download in the background and install the next time you quit, or sooner with Restart to update in the title bar. When off, the title bar shows the new version and waits for you to download it."
  bind:checked={settingsStore.draft.autoDownloadUpdates}
/>
