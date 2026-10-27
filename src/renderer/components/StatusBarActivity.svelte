<script lang="ts">
  /**
   * The activity lozenge: a dot and one word for what the agent is doing
   * (the tool's name, Thinking, Writing, Ready, or Needs you, which fills
   * it amber). Its width is fixed, so the bar doesn't shift as the word
   * changes. The square is the state and the word is the kind, as in the
   * Thread tab. A rate-limit warning puts an amber mark on its corner.
   *
   * Its popup holds the detail the bar used to show: the tools still
   * running (a subagent's open its thread), background tasks (with Stop),
   * the rate limit and memory compaction, the agent's tasks and the
   * thread's files (each a list of its own, with a way back), and how long
   * the last turn took and what it cost (StatusBarLastTurn).
   */
  import { messageStore, type ChatToolCallMessage, type PendingTool } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { isAgentCall } from '../lib/message-view.js';
  import { rateLimitStore } from '../stores/rateLimit.svelte.js';
  import { memoryStore } from '../stores/memory.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { threadItemsStore } from '../stores/threadItems.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import { formatTokens } from '../lib/context-usage.js';
  import { whileShown } from '../lib/while-shown.js';
  import { lozenge, lozengeMark } from '../lib/lozenge.js';
  import { taskProgress } from '../../shared/thread-items.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import { menuItem } from '$lib/components/ui/menu/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import StatusBarPopover from './StatusBarPopover.svelte';
  import StatusBarTasks from './StatusBarTasks.svelte';
  import StatusBarFiles from './StatusBarFiles.svelte';
  import StatusBarLastTurn from './StatusBarLastTurn.svelte';
  import ImageLightbox from './ImageLightbox.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** A permission prompt or question is waiting on the user. */
  let needsInput = $derived(messageStore.needsInput(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

  // Every conversation's status bar is mounted, hidden but for the open
  // one's. The lists below go over the whole thread, so a hidden one keeps
  // what it last showed until it's open again.
  let threadOpen = $derived(store.activeSessionId === sessionId);
  let pendingTools = $derived.by(whileShown(() => threadOpen, () => messageStore.getPendingTools(sessionId)));
  /** All of them are subagents' calls: the conversation itself may be idle. */
  let onlySubagentTools = $derived(pendingTools.length > 0 && pendingTools.every((t) => t.inSubagent));
  let rateLimit = $derived(rateLimitStore.get(sessionId));
  let showRateLimit = $derived(!!rateLimit && rateLimit.status !== 'allowed');
  let rateLimited = $derived(rateLimit?.status === 'rejected');
  /** Memory compaction running for this session's repo. */
  let memoryCompacting = $derived.by(() => {
    const repo = store.sessions.find((s) => s.id === sessionId)?.repoPath;
    if (!repo) return false;
    return memoryStore.compacting && memoryStore.compactingRepo === repo;
  });
  let backgroundTasks = $derived(backgroundTaskStore.get(sessionId));
  /** The Agent calls in the conversation, so a background subagent's task
   *  can open its thread. */
  let agentCalls = $derived.by(whileShown(() => threadOpen, () => new Set(
    messageStore.getMessages(sessionId).filter(isAgentCall).map((m) => (m as ChatToolCallMessage).toolUseId),
  )));
  let runningBgTasks = $derived(backgroundTasks.filter((t) => t.status === 'running'));
  let bgTaskStopError = $state('');

  // The thread's tasks and files load the first time it is the open thread
  // (every pane is mounted, and a hidden one needn't ask), then stay current
  // with its live events.
  $effect(() => {
    if (threadOpen) threadItemsStore.ensure(sessionId);
  });
  let items = $derived(threadItemsStore.get(sessionId));
  let tasks = $derived(items?.tasks ?? []);
  let files = $derived(items?.files ?? []);
  let progress = $derived(taskProgress(tasks));

  let lastResult = $derived(messageStore.lastResult(sessionId));
  let hasLastTurn = $derived(lastResult?.durationMs !== undefined || lastResult?.totalCostUsd !== undefined);

  type Now = {
    word: string;
    /** The word's colour; the dot carries the state. */
    wordClass: string;
    dot: 'working' | 'attention' | 'error' | 'muted';
    /** A line under the word in the popup, when the word needs one. */
    sentence?: string;
  };

  /** The lozenge's word, most pressing first: an answer the agent waits
   *  for, then what it is doing, then work still going on without it. */
  let now = $derived.by((): Now => {
    if (needsInput) {
      return { word: 'Needs you', wordClass: '', dot: 'attention', sentence: 'The agent is waiting for your answer in the Thread tab.' };
    }
    if (isRunning) {
      if (activity.activity === 'thinking') return { word: 'Thinking', wordClass: 'text-purple-400', dot: 'working' };
      if (activity.activity === 'tool_starting') return { word: activity.toolName ?? 'Tool', wordClass: 'text-yellow-400', dot: 'working' };
      if (activity.activity === 'generating') return { word: 'Writing', wordClass: 'text-status-working', dot: 'working' };
      return { word: 'Working', wordClass: 'text-status-working', dot: 'working' };
    }
    if (onlySubagentTools) return { word: 'Subagent', wordClass: 'text-yellow-400', dot: 'working', sentence: 'A subagent is still running a tool.' };
    if (runningBgTasks.length > 0) return { word: 'Background', wordClass: 'text-status-working', dot: 'working', sentence: 'A background task is still running.' };
    if (memoryCompacting) return { word: 'Compacting', wordClass: 'text-status-working', dot: 'working', sentence: 'Project memory is being compacted.' };
    if (rateLimited) return { word: 'Rate limited', wordClass: 'text-red-400', dot: 'error' };
    return { word: 'Ready', wordClass: '', dot: 'muted', sentence: 'Ready for your next message.' };
  });
  /** The current tool's running time, shown in the popup. */
  let toolSeconds = $derived(
    isRunning && !needsInput && activity.activity === 'tool_starting' && activity.elapsedSeconds ? Math.round(activity.elapsedSeconds) : 0,
  );
  /** A rate-limit warning the word doesn't already say. */
  let rateMark = $derived(showRateLimit && now.word !== 'Rate limited');

  let open = $state(false);
  /** The popup's page: the summary, or the tasks or files list. */
  let view = $state<'summary' | 'tasks' | 'files'>('summary');
  $effect(() => { if (!open) view = 'summary'; });
  /** An image from the files list, shown full size outside the popup. */
  let lightbox = $state<{ src: string; label: string } | null>(null);

  let lozengeTitle = $derived(
    `${now.word}${toolSeconds ? ` (${toolSeconds}s)` : ''}${rateMark ? ', rate limit warning' : ''}. Click for tools, background tasks, tasks, files and usage`,
  );

  async function stopBgTask(taskId: string) {
    bgTaskStopError = '';
    try {
      await backgroundTaskStore.stop(sessionId, taskId);
    } catch (err) {
      bgTaskStopError = err instanceof Error ? err.message : String(err);
    }
  }

  // Hidden, the popup's lists keep what they last showed (whileShown), so
  // close it rather than have it come back open and out of date.
  $effect(() => { if (!threadOpen) open = false; });

  function openSubagent(toolUseId: string) {
    open = false;
    subagentPanelStore.show(sessionId, toolUseId);
  }

  function showThread() {
    open = false;
    messageStore.setActiveTab(sessionId, 'activity');
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

<StatusBarPopover bind:open label="Activity" panelClass="w-80 max-h-[70vh] overflow-y-auto" testid="activity-popup">
  {#snippet trigger()}
    <button
      onclick={() => (open = !open)}
      class={lozenge({ tone: needsInput ? 'attention' : 'default', open, class: 'w-24 @2xl:w-32' })}
      title={lozengeTitle}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="activity"
    >
      <Pulse tone={now.dot} size="xs" motion={now.dot === 'working' || now.dot === 'attention' ? 'pulse' : 'none'} />
      <span class="truncate {now.wordClass}">{now.word}</span>
      {#if rateMark}<span class={lozengeMark({ tone: 'warning' })}></span>{/if}
    </button>
  {/snippet}

  {#if view === 'tasks' && tasks.length > 0}
    <button class="flex items-center gap-0.5 mb-2 text-muted-foreground hover:text-foreground transition-colors" onclick={() => (view = 'summary')}>
      <ChevronLeftIcon class="size-3" />Activity
    </button>
    <StatusBarTasks {sessionId} {tasks} eventIndex={items?.tasksEventIndex ?? null} onjump={() => (open = false)} />
  {:else if view === 'files' && files.length > 0}
    <button class="flex items-center gap-0.5 mb-2 text-muted-foreground hover:text-foreground transition-colors" onclick={() => (view = 'summary')}>
      <ChevronLeftIcon class="size-3" />Activity
    </button>
    <StatusBarFiles {sessionId} {files} onclose={() => (open = false)} onimage={(image: { src: string; label: string }) => (lightbox = image)} />
  {:else}
    <!-- What the agent is doing, in words. -->
    <div class="flex items-center gap-1.5 min-w-0" data-testid="activity-now">
      <Pulse tone={now.dot} size="xs" motion={now.dot === 'working' || now.dot === 'attention' ? 'pulse' : 'none'} />
      <span class="font-medium {now.wordClass || 'text-foreground'}">{now.word}</span>
      {#if toolSeconds > 0}<span class="text-muted-foreground">{toolSeconds}s</span>{/if}
    </div>
    {#if now.sentence}
      <div class="mt-1 flex items-center gap-2">
        <p class="flex-1 text-muted-foreground">{now.sentence}</p>
        {#if needsInput}
          <Button variant="subtle" size="2xs" onclick={showThread}>Show</Button>
        {/if}
      </div>
    {/if}

    {#if (rateLimit && showRateLimit) || memoryCompacting}
      <div class="mt-2 space-y-1">
        {#if rateLimit && showRateLimit}
          <div class="flex items-center gap-1.5 {rateLimited ? 'text-red-400' : 'text-amber-500'}" data-testid="rate-limit">
            <Pulse tone={rateLimited ? 'error' : 'attention'} size="xs" />
            {rateLimited ? 'Rate limited' : 'Rate limit warning'}
            {#if rateLimit.utilization}({Math.round(rateLimit.utilization * 100)}%){/if}
            {#if rateLimit.resetsAt}
              <span class="text-muted-foreground" title={new Date(rateLimit.resetsAt * 1000).toLocaleString()}>
                resets {formatResetTime(rateLimit.resetsAt)}
              </span>
            {/if}
          </div>
        {/if}
        {#if memoryCompacting}
          <button
            onclick={() => { open = false; memoryStore.panelOpen = true; }}
            class="flex items-center gap-1.5 text-status-working hover:text-foreground transition-colors"
            title="Project memory is being compacted: click to open the memory panel"
          >
            <Pulse tone="current" size="xs" />
            Compacting memory
          </button>
        {/if}
      </div>
    {/if}

    {#if pendingTools.length > 0}
      <div class="mt-3 pt-2 border-t border-border">
        <SectionLabel class="mb-1">{onlySubagentTools ? 'Subagent tools' : 'Tools'} running</SectionLabel>
        <!-- Out to the panel's edges, so a row to pick can reach them
             without the list scrolling sideways. -->
        <div class="space-y-1.5 max-h-48 overflow-y-auto -mx-3 px-3">
          {#each pendingTools as task, i (i)}
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
      </div>
    {/if}

    {#if backgroundTasks.length > 0}
      <div class="mt-3 pt-2 border-t border-border">
        <SectionLabel class="mb-1">Background tasks</SectionLabel>
        {#if bgTaskStopError}
          <Notice tone="danger" class="mb-2 break-words">Could not stop task: {bgTaskStopError}</Notice>
        {/if}
        <div class="space-y-2 max-h-64 overflow-y-auto">
          {#each backgroundTasks as task (task.taskId)}
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
      </div>
    {/if}

    {#if tasks.length > 0 || files.length > 0}
      <!-- Each opens its list in the popup, with a way back. -->
      <div class="mt-3 pt-1 border-t border-border -mx-3">
        {#if tasks.length > 0}
          <button onclick={() => (view = 'tasks')} class={menuItem({ class: 'px-3 justify-between' })} title="The agent's to-do list">
            <span class="text-muted-foreground">Tasks</span>
            <span class="flex items-center gap-1 text-foreground">{progress.done} of {progress.total} done<ChevronRightIcon class="size-3 text-muted-foreground" /></span>
          </button>
        {/if}
        {#if files.length > 0}
          <button onclick={() => (view = 'files')} class={menuItem({ class: 'px-3 justify-between' })} title="Files you attached, the agent made, and tools returned">
            <span class="text-muted-foreground">Files</span>
            <span class="flex items-center gap-1 text-foreground">{files.length} file{files.length === 1 ? '' : 's'}<ChevronRightIcon class="size-3 text-muted-foreground" /></span>
          </button>
        {/if}
      </div>
    {/if}

    {#if hasLastTurn}
      <div class="mt-3 pt-2 border-t border-border">
        <StatusBarLastTurn {sessionId} active={open} onclose={() => (open = false)} />
      </div>
    {/if}
  {/if}
</StatusBarPopover>

<!-- Outside the popup, which closes (and would take it along) on the
     click that lands in the dialog. -->
<ImageLightbox src={lightbox?.src ?? null} label={lightbox?.label ?? ''} onclose={() => (lightbox = null)} />
