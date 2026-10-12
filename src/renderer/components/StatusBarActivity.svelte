<script lang="ts">
  /**
   * The status bar's activity stack: what the agent is doing on top; under
   * it, the rate-limit warning and chips for pending tools, background tasks
   * and memory compaction.
   */
  import { messageStore, type ChatToolCallMessage, type PendingTool } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { isAgentCall } from '../lib/message-view.js';
  import { rateLimitStore } from '../stores/rateLimit.svelte.js';
  import { memoryStore } from '../stores/memory.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import { formatTokens } from '../lib/context-usage.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { menuItem } from '$lib/components/ui/menu/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** A permission prompt or question is waiting on the user. */
  let needsInput = $derived(messageStore.needsInput(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

  let pendingTools = $derived(messageStore.getPendingTools(sessionId));
  /** All of them are subagents' calls: the conversation itself may be idle. */
  let onlySubagentTools = $derived(pendingTools.length > 0 && pendingTools.every((t) => t.inSubagent));
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
  /** The Agent calls in the conversation, so a background subagent's task
   *  can open its thread. */
  let agentCalls = $derived(new Set(
    messageStore.getMessages(sessionId).filter(isAgentCall).map((m) => (m as ChatToolCallMessage).toolUseId),
  ));
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

  function openSubagent(toolUseId: string) {
    tasksExpanded = false;
    bgTasksExpanded = false;
    subagentPanelStore.show(sessionId, toolUseId);
  }
</script>

{#snippet pendingTool(task: PendingTool)}
  <Pulse size="xs" />
  <span class="text-yellow-400 font-medium shrink-0">{task.toolName}</span>
  <span class="text-muted-foreground truncate flex-1">{task.summary}</span>
  {#if task.inSubagent}
    <span class="text-muted-foreground shrink-0">in {task.inSubagent}</span>
  {/if}
  {#if task.elapsedSeconds && task.elapsedSeconds > 0}
    <span class="text-muted-foreground shrink-0">{Math.round(task.elapsedSeconds)}s</span>
  {/if}
{/snippet}

<!-- Session state on top; transient chips (rate limit, pending tools,
     background tasks, memory compaction) underneath. -->
<div class="flex flex-col gap-px leading-snug">
  <span class="flex items-center gap-1.5 whitespace-nowrap" data-testid="activity">
    {#if needsInput}
      <!-- Blocked on a permission prompt or a question: the one state that
           needs you, so it wins over what the agent was doing. Amber, like
           the Thread tab's dot for the same thing. -->
      <Pulse tone="attention" size="xs" />
      <span class="text-status-attention">waiting for you</span>
    {:else if isRunning}
      <!-- The square is blue whatever the agent is doing (in progress);
           the word after it carries the kind of work, as in the Thread tab. -->
      <Pulse size="xs" />
      {#if activity.activity === 'thinking'}
        <span class="text-purple-400">thinking</span>
      {:else if activity.activity === 'tool_starting'}
        <span class="text-yellow-400 truncate max-w-32">
          {activity.toolName ?? 'tool'}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0}&nbsp;({Math.round(activity.elapsedSeconds)}s){/if}
        </span>
      {:else if activity.activity === 'generating'}
        <span class="text-status-working">writing</span>
      {:else}
        <span class="text-status-working">running</span>
      {/if}
    {:else}
      <Pulse tone="muted" size="xs" motion="none" />
      <span>idle</span>
    {/if}
  </span>

  {#if showRateLimit || pendingTools.length > 0 || backgroundTasks.length > 0 || memoryCompacting}
    <div class="flex items-center gap-3 text-caption">
      {#if rateLimit && showRateLimit}
        <span class="flex items-center gap-1 text-caption whitespace-nowrap {rateLimit.status === 'rejected' ? 'text-red-400' : 'text-amber-500'}" data-testid="rate-limit">
          <Pulse tone={rateLimit.status === 'rejected' ? 'error' : 'attention'} size="xs" />
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
              <Pulse size="xs" />
              {pendingTools.length} {onlySubagentTools ? 'subagent ' : ''}tool{pendingTools.length > 1 ? 's' : ''}
            </button>
          {/snippet}

          <div class="font-medium text-foreground mb-2">Pending Tools</div>
          <!-- Out to the panel's edges, so a row to pick can reach them
               without the list scrolling sideways. -->
          <div class="space-y-1.5 max-h-48 overflow-y-auto -mx-3 px-3">
            {#each pendingTools as task}
              {#if task.subagentCall}
                {@const call = task.subagentCall}
                <!-- A row to pick, like a menu's, its text in line with the
                     rows that can't be opened. -->
                <button
                  onclick={() => openSubagent(call)}
                  class={menuItem({ class: '-mx-2.5 w-[calc(100%+1.25rem)]' })}
                  title="Open this subagent's thread"
                >
                  {@render pendingTool(task)}
                  <span class="text-muted-foreground shrink-0">&rsaquo;</span>
                </button>
              {:else}
                <div class="flex items-center gap-2">
                  {@render pendingTool(task)}
                </div>
              {/if}
            {/each}
          </div>
        </StatusBarPopover>
      {/if}

      {#if backgroundTasks.length > 0}
        <StatusBarPopover bind:open={bgTasksExpanded}>
          {#snippet trigger()}
            <button
              onclick={() => bgTasksExpanded = !bgTasksExpanded}
              class="flex items-center gap-1 whitespace-nowrap {runningBgTasks.length > 0 ? 'text-status-working' : 'text-muted-foreground'} hover:text-foreground transition-colors"
              title="Background tasks — click for details"
              aria-expanded={bgTasksExpanded}
            >
              {#if runningBgTasks.length > 0}
                <Pulse tone="current" size="xs" />
              {:else}
                <span class="w-1.5 h-1.5 bg-muted-foreground/50"></span>
              {/if}
              {runningBgTasks.length > 0
                ? `${runningBgTasks.length} bg task${runningBgTasks.length > 1 ? 's' : ''}`
                : `${backgroundTasks.length} bg task${backgroundTasks.length > 1 ? 's' : ''}`}
            </button>
          {/snippet}

          <div class="font-medium text-foreground mb-2">Background Tasks</div>
          {#if bgTaskStopError}
            <Notice tone="danger" class="mb-2 break-words">Could not stop task: {bgTaskStopError}</Notice>
          {/if}
          <div class="space-y-2 max-h-64 overflow-y-auto">
            {#each backgroundTasks as task}
              <div class="border border-border/50 p-2">
                <div class="flex items-center gap-2 mb-1">
                  {#if task.status === 'running'}
                    <span class="w-1.5 h-1.5 bg-status-working animate-pulse shrink-0"></span>
                  {:else if task.status === 'completed'}
                    <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                  {:else}
                    <span class="w-1.5 h-1.5 bg-red-500 shrink-0"></span>
                  {/if}
                  {#if task.toolUseId && agentCalls.has(task.toolUseId)}
                    {@const call = task.toolUseId}
                    <!-- The arrow stays in view however long the name. -->
                    <button
                      onclick={() => openSubagent(call)}
                      class="group/open flex items-center gap-1 min-w-0 flex-1 text-left"
                      title="Open this subagent's thread"
                    >
                      <span class="text-foreground font-medium truncate group-hover/open:underline">{task.description || task.taskId}</span>
                      <span class="text-muted-foreground shrink-0">&rsaquo;</span>
                    </button>
                  {:else}
                    <span class="text-foreground font-medium truncate flex-1">{task.description || task.taskId}</span>
                  {/if}
                  <span class="text-muted-foreground shrink-0 capitalize">{task.status}</span>
                  {#if task.status === 'running'}
                    <Button
                      variant="quiet-destructive"
                      size="icon-2xs"
                      onclick={() => stopBgTask(task.taskId)}
                      disabled={task.stopping}
                      class="disabled:cursor-wait"
                      title={task.stopping ? 'Stopping…' : 'Stop task'}
                      aria-label={task.stopping ? 'Stopping task' : 'Stop task'}
                    >
                      <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
                    </Button>
                  {:else}
                    <Button
                      variant="quiet"
                      size="icon-2xs"
                      onclick={() => backgroundTaskStore.remove(sessionId, task.taskId)}
                      title="Dismiss"
                      aria-label="Dismiss"
                    >
                      <XIcon />
                    </Button>
                  {/if}
                </div>
                {#if task.summary}
                  <p class="text-muted-foreground text-micro mb-1 line-clamp-2">{task.summary}</p>
                {/if}
                <div class="flex items-center gap-3 text-micro text-muted-foreground">
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
          class="flex items-center gap-1 whitespace-nowrap text-status-working hover:text-foreground transition-colors"
          title="Project memory is being compacted — click to open the memory panel"
        >
          <Pulse tone="current" size="xs" />
          compacting memory
        </button>
      {/if}
    </div>
  {/if}
</div>
