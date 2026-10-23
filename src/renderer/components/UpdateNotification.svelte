<script lang="ts">
  import type { UpdateStatus } from '../../shared/types.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { releaseNotesUrl } from '../lib/release-notes.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  let status = $state<UpdateStatus | null>(null);
  let restarting = $state(false);

  $effect(() => {
    let heard = false;
    const unsub = window.groveBench.onUpdateStatus((s: UpdateStatus) => {
      heard = true;
      status = s;
    });
    // Pick up an update found before this window loaded (or reloaded).
    window.groveBench.getUpdateState()
      .then((state) => { if (!heard) status = state.status; })
      .catch(() => {});
    return unsub;
  });

  async function restart() {
    const working = store.sessions.filter((s) => messageStore.getIsRunning(s.id)).length;
    if (working > 0) {
      const message = working === 1
        ? '1 thread is still working. Restarting stops it; it reopens after the update.'
        : `${working} threads are still working. Restarting stops them; they reopen after the update.`;
      if (!confirm(`${message}\n\nRestart now?`)) return;
    }
    restarting = true;
    try {
      await window.groveBench.restartToUpdate();
    } finally {
      restarting = false;
    }
  }
</script>

<!-- Inside the title bar's drag region: clicks need it switched off here. -->
<div class="update-notification ml-2 flex items-center gap-1.5">
  {#if status?.state === 'available'}
    <Button
      variant="default"
      size="2xs"
      onclick={() => window.groveBench.downloadUpdate()}
      title="Download version {status.info.version}"
    >
      Update v{status.info.version} available
    </Button>
  {:else if status?.state === 'downloading' && status.manual}
    <Badge tone="primary" variant="soft">
      Downloading v{status.info.version} {Math.round(status.percent)}%
    </Badge>
  {:else if status?.state === 'downloaded'}
    {@const version = status.info.version}
    <Button
      variant="default"
      size="2xs"
      onclick={restart}
      disabled={restarting}
      title="Version {version} is ready. Restart now to install it, or it installs when you next quit."
    >
      {restarting ? 'Restarting...' : 'Restart to update'}
    </Button>
    <!-- Opens the release notes page. -->
    <Button
      variant="quiet"
      size="2xs"
      class="underline"
      onclick={() => window.groveBench.openExternal(releaseNotesUrl(version))}
    >
      What's new
    </Button>
  {:else if status?.state === 'error' && (status.manual || status.during === 'download')}
    <!-- Background checks stay out of the title bar, but a failed download
         shows: an update exists and isn't arriving. -->
    <Button
      variant="outline-destructive"
      size="2xs"
      onclick={() => window.groveBench.checkForUpdate()}
      title={status.message}
    >
      Update failed, retry
    </Button>
  {/if}
</div>

<style>
  .update-notification {
    -webkit-app-region: no-drag;
  }
</style>
