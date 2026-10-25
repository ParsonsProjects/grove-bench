<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';

  /** A restore kept a copy of the files it replaced (ChatFilesKeptMessage).
   *  Only the latest copy exists, so only the last of these offers it back;
   *  bringing it back keeps the files it replaces, so it can swap again. */
  let { sessionId, id, reason }: { sessionId: string; id: string; reason: 'rewind' | 'bring_back' } = $props();

  let latest = $derived(messageStore.messagesBySession[sessionId]?.findLast((m) => m.kind === 'files_kept')?.id === id);
  // A running turn would keep editing the files as they come back.
  let running = $derived(messageStore.getIsRunning(sessionId));
  let busy = $state(false);
  let error = $state('');

  async function bringBack() {
    busy = true;
    error = '';
    try {
      await messageStore.bringBackFiles(sessionId);
    } catch (e) {
      error = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

{#snippet bringBackAction()}
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

<Notice tone="neutral" class="my-1" actions={latest ? bringBackAction : undefined}>
  <p>
    {reason === 'rewind'
      ? 'Kept a copy of the files from before the rewind.'
      : 'Brought back the kept files, and kept a copy of the ones they replaced.'}
    {#if !latest}<span class="text-muted-foreground">A later copy replaced it.</span>{/if}
  </p>
  {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
</Notice>
