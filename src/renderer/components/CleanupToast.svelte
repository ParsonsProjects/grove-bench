<script lang="ts">
  /**
   * Says how a Clean Up Old Threads run went once it ends: how many threads
   * went, which couldn't be removed (with why), and which were left alone
   * because they were opened again meanwhile. Shown whether or not its
   * dialog is still open, since the run carries on with it closed.
   */
  import { fly } from 'svelte/transition';
  import { cleanupStore } from '../stores/cleanup.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  const threads = (n: number) => `${n} ${n === 1 ? 'thread' : 'threads'}`;

  // Auto-dismiss; failures linger longer so they aren't missed (as MemoryToast).
  $effect(() => {
    const result = cleanupStore.result;
    if (!result) return;
    const timer = setTimeout(() => { if (cleanupStore.result === result) cleanupStore.result = null; }, result.failed.length ? 12_000 : 6_000);
    return () => clearTimeout(timer);
  });
</script>

{#if cleanupStore.result}
  {@const result = cleanupStore.result}
  {@const failed = result.failed}
  {@const skipped = result.skipped}
  {@const total = result.removed + failed.length + skipped.length}
  <!-- Placed by the toast stack in App.svelte. -->
  <div transition:fly={{ y: 8, duration: 140 }} data-testid="cleanup-toast">
    <div class="bg-popover border border-border shadow-xl">
      <Notice
        tone={failed.length > 0
          ? (result.removed === 0 && skipped.length === 0 ? 'danger' : 'warning')
          : skipped.length > 0 ? 'info' : 'success'}
        title={result.removed === total
          ? `Removed ${threads(result.removed)}`
          : failed.length === total
            ? `Couldn't remove ${threads(failed.length)}`
            : `Removed ${result.removed} of ${threads(total)}`}
      >
        {#snippet actions()}
          <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => (cleanupStore.result = null)}>
            <XIcon />
          </Button>
        {/snippet}
        {#if failed.length > 0}
          <p>
            Couldn't remove {failed.map((f) => f.label).join(', ')}: {failed[0].error}{failed.length > 1 && failed.some((f) => f.error !== failed[0].error) ? ' (and other errors)' : ''}
          </p>
          <p>{failed.length === 1 ? 'It stays' : 'They stay'} in the list for next time.</p>
        {/if}
        {#if skipped.length > 0}
          <p>Left {skipped.join(', ')} alone: {skipped.length === 1 ? 'it was' : 'they were'} opened again during the clean-up.</p>
        {/if}
      </Notice>
    </div>
  </div>
{/if}
