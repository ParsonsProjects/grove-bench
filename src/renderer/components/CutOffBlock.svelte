<script lang="ts">
  import PlayIcon from '@lucide/svelte/icons/play';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { messageStore, type ChatCutOffMessage } from '../stores/messages.svelte.js';
  import { cutOffDivider, cutOffReasonText } from '../../shared/cut-off.js';

  /** A turn cut off when Grove Bench stopped (cut-off.ts). The latest one,
   *  unanswered, offers Continue and Dismiss; once answered (a prompt after
   *  it, or dismissed), it's a line in the thread saying what happened. */
  let { sessionId, message }: { sessionId: string; message: ChatCutOffMessage } = $props();

  let open = $derived(messageStore.openCutOff(sessionId)?.id === message.id);
  // Continue already in the queue, waiting for the agent to be ready.
  let continuing = $derived(messageStore.hasQueuedContinue(sessionId));
</script>

{#if open}
  <Notice tone="warning" title="This turn was cut off" class="my-1">
    {#snippet actions()}
      <Button
        size="2xs"
        variant="subtle-primary"
        disabled={continuing}
        title="Ask the agent to check where it got to and carry on"
        onclick={() => messageStore.continueCutOff(sessionId)}
      >
        <PlayIcon />
        {continuing ? 'Continuing…' : 'Continue'}
      </Button>
      <Button
        size="2xs"
        variant="subtle"
        disabled={continuing}
        title="Leave the thread as it is"
        onclick={() => messageStore.dismissCutOff(sessionId)}
      >
        Dismiss
      </Button>
    {/snippet}
    <p>{cutOffReasonText(message.reason, message.at)} Its last step may not have finished.</p>
  </Notice>
{:else}
  <div class="my-1 flex items-center gap-2 text-caption text-muted-foreground" role="note">
    <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
    {cutOffDivider(message.reason, message.at)}
    <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
  </div>
{/if}
