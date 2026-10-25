<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';

  /** A restore kept a copy of the files it replaced (ChatFilesKeptMessage),
   *  which this line brings back. Bringing it back keeps the files it
   *  replaces in turn, so it can always be swapped again. */
  let { sessionId, reason, copy }: { sessionId: string; reason: 'rewind' | 'bring_back' | 'unfinished'; copy: string } = $props();

  const TEXT = {
    rewind: 'Kept a copy of the files from before the rewind.',
    bring_back: 'Brought back a kept copy of the files, and kept a copy of the ones it replaced.',
    unfinished: "Couldn't finish restoring the files, so some may have changed. Kept a copy of them from just before.",
  } as const;

  // A running turn would keep editing the files as they come back.
  let running = $derived(messageStore.getIsRunning(sessionId));
  let busy = $state(false);
  let error = $state('');

  async function bringBack() {
    busy = true;
    error = '';
    try {
      await messageStore.bringBackFiles(sessionId, copy);
    } catch (e) {
      error = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<Notice tone={reason === 'unfinished' ? 'warning' : 'neutral'} class="my-1">
  {#snippet actions()}
    <Button
      size="2xs"
      variant="link"
      disabled={busy || running}
      title={running ? 'Waits for the agent to finish its turn' : 'Put these files back. The ones they replace are kept.'}
      onclick={bringBack}
    >
      {busy ? 'Bringing back…' : 'Bring them back'}
    </Button>
  {/snippet}
  <p>{TEXT[reason]}</p>
  {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
</Notice>
