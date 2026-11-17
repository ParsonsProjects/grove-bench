<script lang="ts">
  /** A To do's alert in the app, when its time comes while Grove Bench is
   *  open (stores/todo). The desktop notification shows too while the
   *  window isn't focused. Built like the plan usage toast. */
  import { fly } from 'svelte/transition';
  import { todoStore } from '../stores/todo.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { sessionLabel } from '../lib/os-notify.js';
  import { dueFromPick } from '../lib/todo-due.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  const alert = $derived(todoStore.alert);

  function open() {
    if (!alert) return;
    if (store.sessions.some((s) => s.id === alert.sessionId)) store.activeSessionId = alert.sessionId;
    todoStore.dismissAlert();
  }

  /** Same time tomorrow. */
  function tomorrow() {
    if (!alert) return;
    const d = todoStore.getDetails(alert.sessionId);
    const day = dueFromPick('tomorrow', todoStore.now).at;
    const at = d.due ? new Date(d.due.at) : null;
    const next = new Date(day);
    if (at) next.setHours(at.getHours(), at.getMinutes(), 0, 0);
    todoStore.setDetails(alert.sessionId, { ...d, due: { at: next.getTime(), timed: !!d.due?.timed } });
    todoStore.dismissAlert();
  }
</script>

{#if alert}
  <div transition:fly={{ y: 8, duration: 140 }} data-testid="todo-due-toast">
    <div class="bg-popover border border-border shadow-xl">
      <Notice tone="warning" title="To do: {sessionLabel(alert.sessionId)}">
        {#snippet actions()}
          <Button size="2xs" variant="link" onclick={open}>Open thread</Button>
          <Button size="2xs" variant="quiet" onclick={tomorrow}>Tomorrow</Button>
          <Button size="icon-2xs" variant="quiet" aria-label="Dismiss" onclick={() => todoStore.dismissAlert()}>
            <XIcon />
          </Button>
        {/snippet}
        <p class="text-muted-foreground">{alert.note || 'Its time has come.'}</p>
      </Notice>
    </div>
  </div>
{/if}
