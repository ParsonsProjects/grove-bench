<script lang="ts">
  import type { UpdateStatus } from '../../shared/types.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { releaseNotesUrl } from '../lib/release-notes.js';

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
        ? '1 conversation is still working. Restarting stops it; it reopens after the update.'
        : `${working} conversations are still working. Restarting stops them; they reopen after the update.`;
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

<div class="ml-2 flex items-center gap-1.5">
  {#if status?.state === 'available'}
    <button
      class="update-pill bg-primary/15 text-primary hover:bg-primary/25"
      onclick={() => window.groveBench.downloadUpdate()}
      title="Download version {status.info.version}"
    >
      Update v{status.info.version} available
    </button>
  {:else if status?.state === 'downloading' && status.manual}
    <span class="update-pill bg-primary/10 text-primary cursor-default">
      Downloading v{status.info.version} {Math.round(status.percent)}%
    </span>
  {:else if status?.state === 'downloaded'}
    {@const version = status.info.version}
    <button
      class="update-pill bg-primary/20 text-primary hover:bg-primary/30 font-medium"
      onclick={restart}
      disabled={restarting}
      title="Version {version} is ready. Restart now to install it, or it installs when you next quit."
    >
      {restarting ? 'Restarting...' : 'Restart to update'}
    </button>
    <button
      class="update-link text-muted-foreground hover:text-foreground"
      onclick={() => window.groveBench.openExternal(releaseNotesUrl(version))}
    >
      What's new
    </button>
  {:else if status?.state === 'error' && (status.manual || status.during === 'download')}
    <!-- Background checks stay out of the title bar, but a failed download
         shows: an update exists and isn't arriving. -->
    <button
      class="update-pill bg-destructive/15 text-destructive hover:bg-destructive/25"
      onclick={() => window.groveBench.checkForUpdate()}
      title={status.message}
    >
      Update failed, retry
    </button>
  {/if}
</div>

<style>
  .update-pill,
  .update-link {
    -webkit-app-region: no-drag;
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    border: none;
    cursor: pointer;
  }
  .update-pill {
    padding: 1px 8px;
    border-radius: 9999px;
    transition: background-color 0.15s;
  }
  .update-pill:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .update-link {
    background: none;
    padding: 1px 2px;
    text-decoration: underline;
  }
</style>
