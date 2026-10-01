<script lang="ts">
  /**
   * The status bar's activity stack: what the agent is doing on top; under
   * it, the rate-limit warning and chips for pending tools, background tasks
   * and memory compaction.
   */
  import { messageStore } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { rateLimitStore } from '../stores/rateLimit.svelte.js';
  import { memoryStore } from '../stores/memory.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import { formatTokens } from '../lib/context-usage.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** A permission prompt or question is waiting on the user. */
  let needsInput = $derived(messageStore.needsInput(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

  let pendingTools = $derived(messageStore.getPendingTools(sessionId));
  let rateLimit = $derived(rateLimitStore.get(sessionId));
  let showRateLimit = $derived(!!rateLimit && rateLimit.status !== 'allowed');
  /** Memory compaction (manual or automatic) running for this session's repo. */
  let memoryCompacting = $derived.by(() => {
    const repo = store.sessions.find((s) => s.id === sessionId)?.repoPath;
    if (!repo) return false;
    return (memoryStore.compacting && memoryStore.compactingRepo === repo)
      || memoryStore.autoCompactingRepo === repo;
  });
  let backgroundTasks = $derived(backgroundTaskStore.get(sessionId));
  let runningBgTasks = $derived(backgroundTasks.filter((t) => t.status === 'running'));
  let bgTaskStopError = $state('');

  async function stopBgTask(taskId: string) {
    bgTaskStopError = '';
    try {
      await backgroundTaskStore.stop(sessionId, taskId);
    } catch (err) {
      bgTaskStopError = err instanceof Error ? err.message : String(err);
    }
  }

  let tasksExpanded = $state(false);
  let bgTasksExpanded = $state(false);
</script>

<!-- Session state on top; transient chips (rate limit, pending tools,
     background tasks, memory compaction) underneath. -->
<div class="flex flex-col gap-px leading-snug">
  <span class="flex items-center gap-1.5 whitespace-nowrap" data-testid="activity">
    {#if needsInput}
      <!-- Blocked on a permission prompt or a question: the one state that
           needs you, so it wins over what the agent was doing. Amber, like
           the Thread tab's dot for the same thing. -->
      <span class="w-1.5 h-1.5 bg-amber-500 animate-pulse"></span>
      <span class="text-amber-400">waiting for you</span>
    {:else if isRunning}
      <span class="w-1.5 h-1.5 {activity.activity === 'thinking' ? 'bg-purple-400' : 'bg-primary'} animate-pulse"></span>
      {#if activity.activity === 'thinking'}
        <span class="text-purple-400">thinking</span>
      {:else if activity.activity === 'tool_starting'}
        <span class="text-yellow-400 truncate max-w-32">
          {activity.toolName ?? 'tool'}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0}&nbsp;({Math.round(activity.elapsedSeconds)}s){/if}
        </span>
      {:else if activity.activity === 'generating'}
        <span class="text-primary">writing</span>
      {:else}
        <span class="text-primary">running</span>
      {/if}
    {:else}
      <span class="w-1.5 h-1.5 bg-muted-foreground/60"></span>
      <span>idle</span>
    {/if}
  </span>

  {#if showRateLimit || pendingTools.length > 0 || backgroundTasks.length > 0 || memoryCompacting}
    <div class="flex items-center gap-3 text-[11px]">
      {#if rateLimit && showRateLimit}
        <span class="flex items-center gap-1 text-[11px] whitespace-nowrap {rateLimit.status === 'rejected' ? 'text-red-400' : 'text-yellow-400'}" data-testid="rate-limit">
          <span class="w-1.5 h-1.5 {rateLimit.status === 'rejected' ? 'bg-red-400' : 'bg-yellow-400'} animate-pulse"></span>
          {rateLimit.status === 'rejected' ? 'rate limited' : 'rate warning'}
          {#if rateLimit.utilization}({Math.round(rateLimit.utilization * 100)}%){/if}
          {#if rateLimit.resetsAt}
            <span class="text-muted-foreground" title={new Date(rateLimit.resetsAt * 1000).toLocaleString()}>
              resets {formatResetTime(rateLimit.resetsAt)}
            </span>
          {/if}
        </span>
      {/if}

      {#if pendingTools.length > 0}
        <StatusBarPopover bind:open={tasksExpanded}>
          {#snippet trigger()}
            <button
              onclick={() => tasksExpanded = !tasksExpanded}
              class="flex items-center gap-1 whitespace-nowrap text-yellow-400 hover:text-yellow-300 transition-colors"
              title="Pending tools — click for details"
              aria-expanded={tasksExpanded}
            >
              <span class="w-1.5 h-1.5 bg-yellow-400 animate-pulse"></span>
              {pendingTools.length} tool{pendingTools.length > 1 ? 's' : ''}
            </button>
          {/snippet}

          <div class="font-medium text-foreground mb-2">Pending Tools</div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto">
            {#each pendingTools as task}
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 bg-yellow-400 animate-pulse shrink-0"></span>
                <span class="text-yellow-400 font-medium shrink-0">{task.toolName}</span>
                <span class="text-muted-foreground truncate flex-1">{task.summary}</span>
                {#if task.elapsedSeconds && task.elapsedSeconds > 0}
                  <span class="text-muted-foreground/60 shrink-0">{Math.round(task.elapsedSeconds)}s</span>
                {/if}
              </div>
            {/each}
          </div>
        </StatusBarPopover>
      {/if}

      {#if backgroundTasks.length > 0}
        <StatusBarPopover bind:open={bgTasksExpanded}>
          {#snippet trigger()}
            <button
              onclick={() => bgTasksExpanded = !bgTasksExpanded}
              class="flex items-center gap-1 whitespace-nowrap text-blue-400 hover:text-blue-300 transition-colors"
              title="Background tasks — click for details"
              aria-expanded={bgTasksExpanded}
            >
              {#if runningBgTasks.length > 0}
                <span class="w-1.5 h-1.5 bg-blue-400 animate-pulse"></span>
              {:else}
                <span class="w-1.5 h-1.5 bg-blue-400/50"></span>
              {/if}
              {runningBgTasks.length > 0
                ? `${runningBgTasks.length} bg task${runningBgTasks.length > 1 ? 's' : ''}`
                : `${backgroundTasks.length} bg task${backgroundTasks.length > 1 ? 's' : ''}`}
            </button>
          {/snippet}

          <div class="font-medium text-foreground mb-2">Background Tasks</div>
          {#if bgTaskStopError}
            <p class="text-red-400 text-[10px] mb-2">Could not stop task: {bgTaskStopError}</p>
          {/if}
          <div class="space-y-2 max-h-64 overflow-y-auto">
            {#each backgroundTasks as task}
              <div class="border border-border/50 p-2">
                <div class="flex items-center gap-2 mb-1">
                  {#if task.status === 'running'}
                    <span class="w-1.5 h-1.5 bg-blue-400 animate-pulse shrink-0"></span>
                  {:else if task.status === 'completed'}
                    <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                  {:else}
                    <span class="w-1.5 h-1.5 bg-red-500 shrink-0"></span>
                  {/if}
                  <span class="text-foreground font-medium truncate flex-1">{task.description || task.taskId}</span>
                  <span class="text-muted-foreground/60 shrink-0 capitalize">{task.status}</span>
                  {#if task.status === 'running'}
                    <button
                      onclick={() => stopBgTask(task.taskId)}
                      disabled={task.stopping}
                      class="text-muted-foreground/60 hover:text-red-400 disabled:opacity-40 disabled:cursor-wait transition-colors shrink-0"
                      title={task.stopping ? 'Stopping…' : 'Stop task'}
                      aria-label={task.stopping ? 'Stopping task' : 'Stop task'}
                    >
                      <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
                    </button>
                  {:else}
                    <button
                      onclick={() => backgroundTaskStore.remove(sessionId, task.taskId)}
                      class="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                      title="Dismiss"
                    >
                      &times;
                    </button>
                  {/if}
                </div>
                {#if task.summary}
                  <p class="text-muted-foreground text-[10px] mb-1 line-clamp-2">{task.summary}</p>
                {/if}
                <div class="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                  {#if task.lastToolName}
                    <span class="text-yellow-400">{task.lastToolName}</span>
                  {/if}
                  {#if task.toolUses > 0}
                    <span>{task.toolUses} tool use{task.toolUses !== 1 ? 's' : ''}</span>
                  {/if}
                  {#if task.totalTokens > 0}
                    <span>{formatTokens(task.totalTokens)} tokens</span>
                  {/if}
                  {#if task.durationMs > 0}
                    <span>{(task.durationMs / 1000).toFixed(1)}s</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </StatusBarPopover>
      {/if}

      {#if memoryCompacting}
        <button
          onclick={() => memoryStore.panelOpen = true}
          class="flex items-center gap-1 whitespace-nowrap text-teal-400 hover:text-teal-300 transition-colors"
          title="Project memory is being compacted — click to open the memory panel"
        >
          <span class="w-1.5 h-1.5 bg-teal-400 animate-pulse"></span>
          compacting memory
        </button>
      {/if}
    </div>
  {/if}
</div>
