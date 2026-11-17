<script lang="ts">
  /**
   * A flagged thread's To do, pinned at the top of its Thread tab beside the
   * goal: the note and the date, amber once it is due. Only shown when the
   * To do has a note or a date; a plain flag stays a ring in the sidebar.
   */
  import { todoStore } from '../stores/todo.svelte.js';
  import { dueText } from '../lib/todo-due.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import TodoMark from './TodoMark.svelte';
  import CheckIcon from '@lucide/svelte/icons/check';
  import PencilIcon from '@lucide/svelte/icons/pencil';

  let { sessionId }: { sessionId: string } = $props();

  let details = $derived(todoStore.getDetails(sessionId));
  let visible = $derived(todoStore.has(sessionId) && (!!details.note || !!details.due));
  let due = $derived(todoStore.isDue(sessionId));

  function edit(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    todoStore.openEditor(sessionId, rect.right - 320, rect.bottom + 4);
  }
</script>

{#if visible}
  <div class="px-4 pt-2 shrink-0 min-w-0" data-testid="todo-bar">
    <div class="flex items-start gap-2 border bg-card px-3 py-1.5 text-sm min-w-0 {due ? 'border-status-attention/60' : 'border-input'}">
      <span class="flex items-center gap-1.5 py-0.5 font-medium shrink-0 {due ? 'text-status-attention' : 'text-muted-foreground'}">
        <TodoMark />
        To do
      </span>
      <span class="flex-1 min-w-0 py-0.5 break-words line-clamp-2 {details.note ? 'text-foreground' : 'text-muted-foreground'}">
        {details.note || 'No note'}
      </span>
      {#if details.due}
        <span class="py-0.5 shrink-0 text-xs {due ? 'text-status-attention' : 'text-muted-foreground'}" data-testid="todo-bar-due">
          {dueText(details.due, todoStore.now)}
        </span>
      {/if}
      <div class="flex items-center gap-0.5 py-0.5 shrink-0">
        <Button variant="quiet" size="icon-2xs" onclick={edit} title="Change the note or date" aria-label="Edit the To do"><PencilIcon /></Button>
        <Button variant="quiet" size="icon-2xs" onclick={() => todoStore.set(sessionId, false)} title="Done: clear the To do" aria-label="Done, clear the To do"><CheckIcon /></Button>
      </div>
    </div>
  </div>
{/if}
