<script lang="ts">
  /**
   * The To do popup: why you flagged the thread (a note) and when to come
   * back (one optional date, with an optional time that sets an alert).
   * Opens from Add (or Edit) To Do Note or Date… in the sidebar's menu, and
   * from the thread's To do bar. Mark as To Do stays one click and opens
   * nothing. The flag is already on when it opens, so closing it without
   * typing leaves a plain To do. Clicking away or Enter saves; Escape leaves
   * the note and date as they were.
   */
  import { onMount, onDestroy, untrack } from 'svelte';
  import { todoStore, MAX_TODO_NOTE_LENGTH } from '../stores/todo.svelte.js';
  import { sessionLabel } from '../lib/os-notify.js';
  import { dateInputValue, timeInputValue, dueFromInputs, dueFromPick, dueText, type DuePick } from '../lib/todo-due.js';
  import { menuPanel } from '$lib/components/ui/menu/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import TodoMark from './TodoMark.svelte';
  import XIcon from '@lucide/svelte/icons/x';

  let { sessionId, x, y }: { sessionId: string; x: number; y: number } = $props();

  const initial = untrack(() => todoStore.getDetails(sessionId));
  let note = $state(initial.note ?? '');
  let date = $state(initial.due ? dateInputValue(initial.due.at) : '');
  let time = $state(initial.due?.timed ? timeInputValue(initial.due.at) : '');

  let due = $derived(dueFromInputs(date, time));
  let panel: HTMLDivElement | undefined = $state();
  let noteEl: HTMLTextAreaElement | undefined = $state();

  const PICKS: { pick: DuePick; label: string }[] = [
    { pick: 'tomorrow', label: 'Tomorrow' },
    { pick: 'next-week', label: 'Next Monday' },
  ];
  const pickDate = (p: DuePick) => dateInputValue(dueFromPick(p, todoStore.now).at);

  function save() {
    todoStore.setDetails(sessionId, { note: note.trim() || undefined, due });
    todoStore.closeEditor();
  }

  function clearTodo() {
    todoStore.set(sessionId, false);
    todoStore.closeEditor();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      todoStore.closeEditor();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === noteEl) {
      e.preventDefault();
      save();
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (panel && !panel.contains(e.target as Node)) save();
  }

  // Kept on screen, opening upwards when there's no room below.
  let left = $state(untrack(() => x));
  let top = $state(untrack(() => y));

  onMount(() => {
    if (panel) {
      const rect = panel.getBoundingClientRect();
      if (rect.right > window.innerWidth - 4) left = Math.max(4, window.innerWidth - rect.width - 4);
      if (rect.bottom > window.innerHeight - 4) top = Math.max(4, y - rect.height);
    }
    noteEl?.focus();
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeydown, true);
  });

  onDestroy(() => {
    document.removeEventListener('pointerdown', handlePointerDown, true);
    window.removeEventListener('keydown', handleKeydown, true);
  });

  const fieldClass = 'h-6 bg-background border border-input px-1.5 text-xs text-foreground outline-none focus:border-ring [color-scheme:light_dark] disabled:opacity-50';
</script>

<div
  bind:this={panel}
  class={cn(menuPanel({ padding: 'content' }), 'fixed z-[60] w-80 flex flex-col gap-2.5')}
  style="left: {left}px; top: {top}px"
  role="dialog"
  aria-label="To do"
  data-testid="todo-editor"
>
  <div class="flex items-center gap-1.5 min-w-0">
    <TodoMark class="text-foreground/80" />
    <span class="font-medium text-foreground shrink-0">To do</span>
    <span class="text-muted-foreground truncate min-w-0">· {sessionLabel(sessionId)}</span>
  </div>

  <textarea
    bind:this={noteEl}
    bind:value={note}
    rows="2"
    maxlength={MAX_TODO_NOTE_LENGTH}
    placeholder="What to come back for (optional)"
    aria-label="To do note"
    class="w-full resize-none bg-background border border-input px-2 py-1 text-xs text-foreground outline-none focus:border-ring placeholder:text-muted-foreground"
  ></textarea>

  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-1.5">
      <span class="text-muted-foreground mr-auto">Come back</span>
      {#each PICKS as p (p.pick)}
        {@const value = pickDate(p.pick)}
        <Button
          size="2xs"
          variant="subtle"
          class={date === value ? 'bg-accent text-foreground' : ''}
          aria-pressed={date === value}
          onclick={() => { date = value; }}
        >{p.label}</Button>
      {/each}
    </div>
    <div class="flex items-center gap-1.5">
      <input type="date" bind:value={date} aria-label="Come back on" class="{fieldClass} flex-1 min-w-0" />
      <input type="time" bind:value={time} disabled={!date} aria-label="Alert at (optional)" title={date ? 'Optional: set a time to get an alert' : 'Pick a day first'} class="{fieldClass} w-24" />
      {#if date}
        <Button size="icon-2xs" variant="quiet" aria-label="Remove the date" title="Remove the date" onclick={() => { date = ''; time = ''; }}><XIcon /></Button>
      {/if}
    </div>
    <p class="text-caption text-muted-foreground" data-testid="todo-editor-due">
      {#if due}
        {dueText(due, todoStore.now)}{due.timed ? ', with an alert' : ''}
      {:else}
        No date: it stays in To do until you clear it.
      {/if}
    </p>
  </div>

  <div class="flex items-center gap-1.5 pt-0.5">
    <Button size="2xs" variant="quiet-destructive" onclick={clearTodo}>Clear To Do</Button>
    <span class="flex-1"></span>
    <Button size="2xs" onclick={save}>Save</Button>
  </div>
</div>
