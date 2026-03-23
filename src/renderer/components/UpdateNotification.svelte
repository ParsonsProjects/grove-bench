<script lang="ts">
  import type { UpdateStatus } from '../../shared/types.js';

  let status = $state<UpdateStatus | null>(null);

  $effect(() => {
    const unsub = window.groveBench.onUpdateStatus((s: UpdateStatus) => {
      status = s;
    });
    return unsub;
  });
</script>

{#if status?.state === 'available'}
  <button
    class="update-pill"
    onclick={() => window.groveBench.downloadUpdate()}
    title="Click to download update"
  >
    Update v{status.info.version} available
  </button>
{:else if status?.state === 'downloading'}
  <span class="update-pill downloading">
    Downloading {Math.round(status.percent)}%
  </span>
{:else if status?.state === 'downloaded'}
  <button
    class="update-pill downloaded"
    onclick={() => window.groveBench.installUpdate()}
    title="Quit and install update"
  >
    Restart to update
  </button>
{/if}

<style>
  .update-pill {
    -webkit-app-region: no-drag;
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    padding: 1px 8px;
    border-radius: 9999px;
    cursor: pointer;
    border: none;
    background: hsl(var(--primary) / 0.12);
    color: hsl(var(--primary));
    transition: background 0.15s;
  }
  .update-pill:hover {
    background: hsl(var(--primary) / 0.2);
  }
  .update-pill.downloading {
    cursor: default;
    opacity: 0.8;
  }
  .update-pill.downloaded {
    background: hsl(var(--primary) / 0.18);
    font-weight: 500;
  }
</style>
