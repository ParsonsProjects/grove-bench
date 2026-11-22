<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import XIcon from '@lucide/svelte/icons/x';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import MergeIcon from '@lucide/svelte/icons/merge';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';

  let { sessionId }: { sessionId: string } = $props();

  let queue = $derived(messageStore.getQueue(sessionId));
  let paused = $derived(messageStore.isQueuePaused(sessionId));
  // A turn Grove Bench cut off waits above (CutOffBlock): Continue sends
  // the queue after it.
  let cutOff = $derived(messageStore.openCutOff(sessionId) !== null);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let edit = $derived(messageStore.getQueuedEdit(sessionId));
  let undo = $derived(messageStore.getQueueUndo(sessionId));
  let mergeBlocker = $derived(messageStore.queueMergeBlocker(sessionId));
  let steers = $derived(messageStore.getSteers(sessionId));
  // Send now steers a queued message into the running turn, for an agent
  // that can take one (Claude). Others keep it queued.
  let canSteer = $derived(agentsStore.declares(sessionStore.sessions.find((s) => s.id === sessionId)?.agentType, 'steering'));
  let summary = $derived(
    [steers.length > 0 ? `${steers.length} steering` : '', queue.length > 0 ? `${queue.length} queued` : ''].filter(Boolean).join(' · '),
  );

  // A clock for the holds' countdown, ticking only while one is held.
  let now = $state(Date.now());
  $effect(() => {
    if (!steers.some((s) => s.phase === 'holding')) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  function secondsLeft(sendAt: number): number {
    return Math.max(1, Math.ceil((sendAt - now) / 1000));
  }
  /** The message shown in full. The others show their first line. */
  let openId = $state<string | null>(null);

  function firstLine(text: string): string {
    const line = text.split('\n')[0].trim();
    return line || text.trim();
  }

  /** How many lines a message has past its first. */
  function moreLines(text: string): number {
    return text.trim().split('\n').length - 1;
  }
</script>

<div class="relative">
  {#if queue.length > 0 || steers.length > 0}
    <div class="px-4 pt-2" data-testid="message-queue">
      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>
          {summary}
          {#if queue.length > 0 && paused}
            <span class="text-amber-500">· paused</span>
          {:else if queue.length > 0 && isRunning}
            · sends when the agent is free
          {/if}
        </span>
        <span class="flex-1"></span>
        {#if cutOff && paused && queue.length > 0}
          <span class="text-caption">Goes after the cut-off turn is continued</span>
        {/if}
        <div class="flex items-center gap-1">
          {#if paused}
            <Button
              variant="subtle-primary"
              size="2xs"
              onclick={() => messageStore.resumeQueue(sessionId)}
              title="Send the queued messages again, one turn each"
            >Resume</Button>
          {/if}
          <!-- One message has its own Remove; these are for two or more. -->
          {#if queue.length > 1}
            <Button
              variant="subtle"
              size="2xs"
              onclick={() => messageStore.mergeQueue(sessionId)}
              disabled={mergeBlocker !== null}
              title={mergeBlocker ?? 'Merge the queued messages into one, so they go in a single turn'}
            ><MergeIcon />Merge</Button>
            <Button
              variant="outline-destructive"
              size="2xs"
              onclick={() => messageStore.clearQueue(sessionId)}
              title="Remove every queued message. You can undo it."
            ><Trash2Icon />Clear queue</Button>
          {/if}
        </div>
      </div>
      <ul class="flex flex-col gap-1 max-h-32 overflow-y-auto">
        {#each steers as steer (steer.id)}
          <li class="flex items-center gap-2 text-xs border border-border/70 bg-card/60 px-2 py-1" data-testid="steer-row">
            <Pulse size="xs" class="mx-0.5" />
            <span class="min-w-0 flex-1 truncate text-foreground/90" title={steer.displayText}>{firstLine(steer.displayText)}</span>
            {#if steer.phase === 'holding'}
              <span class="text-muted-foreground shrink-0 tabular-nums">Sending in {secondsLeft(steer.sendAt)}s</span>
              <Button
                variant="link"
                size="inline"
                onclick={() => messageStore.takeBackSteer(sessionId, steer.id)}
                title="Put it back in the message box"
              >Take back</Button>
            {:else}
              <span class="text-muted-foreground shrink-0" title="The agent reads it after its current tool call. It can't be taken back now.">Sent · not read yet</span>
            {/if}
          </li>
        {/each}
        {#each queue as item, i (item.id)}
          {@const open = openId === item.id}
          {@const more = moreLines(item.displayText)}
          {@const editing = edit?.id === item.id}
          <li
            class="flex {open ? 'items-start' : 'items-center'} gap-2 text-xs border border-border/70 px-2 py-1
              {editing ? 'border-l-2 border-l-primary bg-accent' : 'bg-card/60'}"
          >
            <span class="text-muted-foreground shrink-0 font-mono">{i + 1}.</span>
            <button
              type="button"
              class="min-w-0 flex-1 text-left cursor-pointer {open ? 'whitespace-pre-wrap break-words' : 'truncate'} {item.isCommand ? 'font-mono text-primary' : 'text-foreground/90'}"
              onclick={() => (openId = open ? null : item.id)}
              aria-expanded={more > 0 ? open : undefined}
              title={open ? 'Show the first line only' : item.displayText}
            >{open ? item.displayText.trim() : firstLine(item.displayText)}</button>
            {#if !open && more > 0}
              <span class="text-muted-foreground shrink-0">+{more} {more === 1 ? 'line' : 'lines'}</span>
            {/if}
            {#if item.images?.length}
              <span class="text-muted-foreground shrink-0">{item.images.length} image{item.images.length === 1 ? '' : 's'}</span>
            {/if}
            {#if item.files?.length}
              <span class="text-muted-foreground shrink-0">{item.files.length} file{item.files.length === 1 ? '' : 's'}</span>
            {/if}
            {#if item.notRead}
              <Badge tone="muted" title="The agent stopped before it read this message">not read</Badge>
            {:else if item.continued}
              <Badge tone="muted" title="Continue on the cut-off turn: it goes once the agent is ready">continue</Badge>
            {/if}
            {#if editing}
              <span class="text-primary shrink-0">editing</span>
            {/if}
            {#if !isRunning}
              <Button
                variant="link"
                size="inline"
                onclick={() => messageStore.sendQueuedNow(sessionId, item.id)}
                title="Send it now as the next message"
              >Send</Button>
            {:else if canSteer}
              {@const steerable = messageStore.canSteerQueued(item)}
              <Button
                variant="link"
                size="inline"
                onclick={() => messageStore.steerQueued(sessionId, item.id)}
                disabled={!steerable}
                title={steerable
                  ? 'Steer it into this turn: the agent reads it after its current tool call'
                  : item.isCommand ? "A command can't be steered: it waits for the turn to end" : "Messages with images or files can't be steered: it waits for the turn to end"}
              >Send now</Button>
            {/if}
            <Button
              variant="quiet"
              size="inline"
              onclick={() => messageStore.editQueuedMessage(sessionId, item.id)}
              title="Edit it in the message box. It keeps its place."
            >Edit</Button>
            <Button
              variant="quiet"
              size="icon-2xs"
              onclick={() => messageStore.moveQueuedMessage(sessionId, item.id, -1)}
              disabled={i === 0}
              class="-my-0.5"
              title="Move up"
              aria-label="Move up"
            ><ChevronUpIcon /></Button>
            <Button
              variant="quiet"
              size="icon-2xs"
              onclick={() => messageStore.moveQueuedMessage(sessionId, item.id, 1)}
              disabled={i === queue.length - 1}
              class="-my-0.5"
              title="Move down"
              aria-label="Move down"
            ><ChevronDownIcon /></Button>
            <Button
              variant="quiet-destructive"
              size="icon-2xs"
              onclick={() => messageStore.removeQueuedMessage(sessionId, item.id)}
              class="-my-0.5"
              title="Remove from queue"
              aria-label="Remove queued message"
            ><XIcon /></Button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- The same toast as a discarded draft's (DraftUndoToast), over the
       thread: mb-11 clears the status bar above the message box. -->
  {#if undo}
    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-11 z-50 animate-in" role="status">
      <div class="flex items-center gap-3 bg-popover border border-border shadow-xl pl-3 pr-1.5 py-1.5 text-xs text-foreground whitespace-nowrap">
        <span>{undo.label}</span>
        <Button size="xs" variant="subtle-primary" onclick={() => messageStore.undoQueueChange(sessionId)}>Undo</Button>
      </div>
    </div>
  {/if}
</div>
