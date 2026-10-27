<script lang="ts">
  /**
   * The agent's to-do list as it stands (shared/thread-items.ts), with what
   * is done ticked, and a way to the message that last changed it. Shown in
   * the activity popup (StatusBarActivity), which closes on `onjump`.
   */
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { showInThread } from '../lib/thread-files.js';
  import { taskProgress, type ThreadTask, type ThreadTaskStatus } from '../../shared/thread-items.js';

  let {
    sessionId,
    tasks,
    eventIndex,
    onjump,
  }: {
    sessionId: string;
    tasks: ThreadTask[];
    eventIndex: number | null;
    /** Called before the Thread tab opens at the message. */
    onjump?: () => void;
  } = $props();

  let progress = $derived(taskProgress(tasks));
  /** A task in progress only moves while the agent is working on it. */
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  const STATUS_WORDS: Record<ThreadTaskStatus, string> = {
    pending: 'To do',
    in_progress: 'In progress',
    completed: 'Done',
    cancelled: 'Cancelled',
  };

  function jump() {
    if (eventIndex === null) return;
    onjump?.();
    showInThread(sessionId, eventIndex);
  }
</script>

<div class="flex items-center justify-between mb-2">
  <span class="font-medium text-foreground">Tasks</span>
  <span class="text-muted-foreground">{progress.done} of {progress.total} done</span>
</div>
<ol class="space-y-1 max-h-64 overflow-y-auto">
  {#each tasks as task, i (i)}
    {@const settled = task.status === 'completed' || task.status === 'cancelled'}
    <li class="flex items-start gap-2" title={task.status === 'in_progress' && task.activeForm ? task.activeForm : undefined}>
      <span class="size-3 shrink-0 mt-0.5 flex items-center justify-center" aria-hidden="true">
        {#if task.status === 'completed'}
          <CheckIcon class="size-3 text-green-400" />
        {:else if task.status === 'in_progress'}
          <Pulse size="xs" motion={isRunning ? 'pulse' : 'none'} />
        {:else}
          <span class="size-1.5 border border-muted-foreground"></span>
        {/if}
      </span>
      <span class="sr-only">{STATUS_WORDS[task.status]}:</span>
      <span class="min-w-0 break-words {settled ? 'text-muted-foreground line-through' : task.status === 'in_progress' ? 'text-foreground font-medium' : 'text-foreground'}">
        {task.content}
      </span>
    </li>
  {/each}
</ol>
{#if eventIndex !== null}
  <div class="flex justify-end mt-2 pt-2 border-t border-border">
    <Button variant="quiet" size="inline" onclick={jump} title="Show the message that last changed this list">
      Show in thread
    </Button>
  </div>
{/if}
