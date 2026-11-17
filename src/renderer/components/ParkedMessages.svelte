<script lang="ts">
  /**
   * Messages parked in this thread: kept, not sent. Each waits for Send, or
   * for its send-at time, when it goes the way Send does (straight away if
   * the agent is free, otherwise to the queue below). Shown above the queue,
   * built like it.
   */
  import { messageStore } from '../stores/messages.svelte.js';
  import { todoStore } from '../stores/todo.svelte.js';
  import { formatDue, dateInputValue, timeInputValue, dueFromPick } from '../lib/todo-due.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import SquareParkingIcon from '@lucide/svelte/icons/square-parking';
  import XIcon from '@lucide/svelte/icons/x';

  let { sessionId }: { sessionId: string } = $props();

  let parked = $derived(messageStore.getParked(sessionId));

  /** The message whose send-at time is being set, and the picker's value. */
  let scheduling = $state<string | null>(null);
  let when = $state('');

  function firstLine(text: string): string {
    const line = text.split('\n')[0].trim();
    return line || text.trim();
  }

  const toInput = (ms: number) => `${dateInputValue(ms)}T${timeInputValue(ms)}`;

  function startScheduling(id: string, sendAt: number | undefined) {
    if (scheduling === id) { scheduling = null; return; }
    scheduling = id;
    when = sendAt ? toInput(sendAt) : toInput(Date.now() + 60 * 60 * 1000);
  }

  function setWhen(id: string) {
    const at = new Date(when).getTime();
    if (!Number.isNaN(at)) messageStore.setParkedSendAt(sessionId, id, at);
    scheduling = null;
  }

  function tomorrowNine(): string {
    const d = new Date(dueFromPick('tomorrow', Date.now()).at);
    d.setHours(9, 0, 0, 0);
    return toInput(d.getTime());
  }
</script>

{#if parked.length > 0}
  <div class="px-4 pt-2" data-testid="parked-messages">
    <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
      <span>{parked.length} parked · kept until you send {parked.length === 1 ? 'it' : 'them'}</span>
    </div>
    <ul class="flex flex-col gap-1 max-h-40 overflow-y-auto">
      {#each parked as item (item.id)}
        <li class="flex flex-col border border-border/70 bg-card/60 text-xs">
          <div class="flex items-center gap-2 px-2 py-1">
            <SquareParkingIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="truncate flex-1 {item.isCommand ? 'font-mono text-primary' : 'text-foreground/90'}" title={item.displayText}>
              {firstLine(item.displayText)}
            </span>
            {#if item.images?.length}
              <span class="text-muted-foreground shrink-0">{item.images.length} image{item.images.length === 1 ? '' : 's'}</span>
            {/if}
            {#if item.files?.length}
              <span class="text-muted-foreground shrink-0">{item.files.length} file{item.files.length === 1 ? '' : 's'}</span>
            {/if}
            <Button
              variant="quiet"
              size="inline"
              class="shrink-0 {item.sendAt ? 'text-foreground/80' : ''}"
              onclick={() => startScheduling(item.id, item.sendAt)}
              title={item.sendAt ? 'Change when it sends' : 'Send it by itself at a set time'}
              aria-expanded={scheduling === item.id}
            ><ClockIcon />{item.sendAt ? `Sends ${formatDue({ at: item.sendAt, timed: true }, todoStore.now)}` : 'Send at…'}</Button>
            <Button variant="link" size="inline" onclick={() => messageStore.sendParked(sessionId, item.id)} title="Send it now, or queue it if the agent is busy">Send</Button>
            <Button variant="quiet" size="inline" onclick={() => messageStore.editParked(sessionId, item.id)} title="Move back to the message box to change it">Edit</Button>
            <Button
              variant="quiet-destructive"
              size="icon-2xs"
              onclick={() => messageStore.removeParked(sessionId, item.id)}
              class="-my-0.5"
              title="Delete this parked message"
              aria-label="Delete parked message"
            ><XIcon /></Button>
          </div>
          {#if scheduling === item.id}
            <div class="flex items-center gap-1.5 px-2 pb-1.5 pl-7.5" data-testid="parked-send-at">
              <span class="text-muted-foreground">Send at</span>
              <input
                type="datetime-local"
                bind:value={when}
                aria-label="Send at"
                class="h-6 bg-background border border-input px-1.5 text-xs text-foreground outline-none focus:border-ring [color-scheme:light_dark]"
              />
              <Button size="2xs" variant="subtle" onclick={() => { when = toInput(Date.now() + 60 * 60 * 1000); }}>In 1 hour</Button>
              <Button size="2xs" variant="subtle" onclick={() => { when = tomorrowNine(); }}>Tomorrow 9:00</Button>
              <span class="flex-1"></span>
              {#if item.sendAt}
                <Button size="2xs" variant="quiet" onclick={() => { messageStore.setParkedSendAt(sessionId, item.id, undefined); scheduling = null; }}>Remove time</Button>
              {/if}
              <Button size="2xs" onclick={() => setWhen(item.id)}>Set</Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
