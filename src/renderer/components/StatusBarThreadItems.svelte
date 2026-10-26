<script lang="ts">
  /**
   * Tasks over Files, as one stack, so both popovers open above the pair
   * rather than over each other. The thread's items load the first time it
   * is the open thread (every pane is mounted, and a hidden one needn't
   * ask), then stay current with its live events.
   * A narrow bar drops the stack, unless a task is still to do: what the
   * agent is working through is worth the room.
   */
  import StatusBarTasks from './StatusBarTasks.svelte';
  import StatusBarFiles from './StatusBarFiles.svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { threadItemsStore } from '../stores/threadItems.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  $effect(() => {
    if (store.activeSessionId === sessionId) threadItemsStore.ensure(sessionId);
  });

  let items = $derived(threadItemsStore.get(sessionId));
  let tasks = $derived(items?.tasks ?? []);
  let files = $derived(items?.files ?? []);
  let unfinished = $derived(tasks.some((t) => t.status === 'pending' || t.status === 'in_progress'));
  let display = $derived(
    tasks.length === 0 && files.length === 0 ? 'hidden' : unfinished ? 'flex' : 'hidden @2xl:flex',
  );
</script>

<div class="relative {display} flex-col gap-px leading-snug">
  <StatusBarTasks {sessionId} {tasks} eventIndex={items?.tasksEventIndex ?? null} />
  <StatusBarFiles {sessionId} {files} />
</div>
