<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import ChangesReviewPanel from './ChangesReviewPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { OrchTask, OrchTaskStatus } from '../../shared/types.js';

  let { sessionId }: { sessionId: string } = $props();

  let activeTab = $derived(messageStore.getActiveTab(sessionId));

  let fileChanges = $derived(messageStore.getLastTurnFileChanges(sessionId));
  let hasChanges = $derived(fileChanges.length > 0);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  // Orchestration integration
  let session = $derived(store.sessions.find(s => s.id === sessionId));
  let orchJob = $derived(session?.orchJobId ? orchStore.jobs.find(j => j.id === session!.orchJobId) : null);
  let hasOrch = $derived(!!orchJob);
  let hasPlan = $derived((orchJob?.tasks.length ?? 0) > 0);
  let approving = $state(false);
  let retrying = $state<string | null>(null);


  // Kanban columns
  interface KanbanColumn {
    key: string;
    label: string;
    statuses: OrchTaskStatus[];
    color: string;
    dotClass: string;
  }

  const columns: KanbanColumn[] = [
    { key: 'queued', label: 'Queued', statuses: ['pending'], color: 'border-neutral-500/40', dotClass: 'bg-neutral-500' },
    { key: 'active', label: 'In Progress', statuses: ['spawning', 'running'], color: 'border-blue-500/40', dotClass: 'bg-blue-500 animate-pulse' },
    { key: 'done', label: 'Done', statuses: ['completed'], color: 'border-green-500/40', dotClass: 'bg-green-500' },
    { key: 'blocked', label: 'Failed', statuses: ['failed', 'cancelled'], color: 'border-red-500/40', dotClass: 'bg-red-500' },
  ];

  function tasksForColumn(col: KanbanColumn): OrchTask[] {
    if (!orchJob) return [];
    return orchJob.tasks.filter((t) => col.statuses.includes(t.status));
  }

  function focusTask(taskSessionId: string | null) {
    if (!taskSessionId) return;
    store.activeSessionId = taskSessionId;
  }

  async function handleApprove() {
    if (!orchJob) return;
    approving = true;
    try {
      const edits = orchJob.tasks.map((t) => ({
        id: t.id,
        instruction: t.instruction,
        description: t.description,
        branchName: t.branchName,
      }));
      await window.groveBench.approveOrchPlan(orchJob.id, edits);
      orchStore.subscribe(orchJob.id);
    } catch { /* best effort */ }
    approving = false;
  }

  async function handleRetry(taskId: string) {
    if (!orchJob) return;
    retrying = taskId;
    try {
      await window.groveBench.retryOrchTask(orchJob.id, taskId);
    } catch { /* best effort */ }
    retrying = null;
  }

  let failedTasks = $derived(orchJob?.tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled') ?? []);
  let retryingAll = $state(false);

  async function handleRetryAll() {
    if (!orchJob || failedTasks.length === 0) return;
    retryingAll = true;
    try {
      for (const task of failedTasks) {
        await window.groveBench.retryOrchTask(orchJob.id, task.id);
      }
    } catch { /* best effort */ }
    retryingAll = false;
  }

  function depNames(task: OrchTask): string {
    if (!orchJob || task.dependsOn.length === 0) return '';
    return task.dependsOn.map((depId) => {
      const dep = orchJob!.tasks.find((t) => t.id === depId);
      return dep ? dep.description.slice(0, 20) : depId;
    }).join(', ');
  }

  function elapsed(task: OrchTask): string {
    if (!task.completedAt) return '';
    const ms = task.completedAt - task.createdAt;
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  let completedCount = $derived(orchJob?.tasks.filter((t) => t.status === 'completed').length ?? 0);
  let totalCount = $derived(orchJob?.tasks.length ?? 0);
  let totalCost = $derived(orchJob?.tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) ?? 0);
  let progressPct = $derived(totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    return msgs.some((m) => m.kind === 'permission' && !m.resolved);
  });

  function switchTab(tab: 'activity' | 'changes' | 'plan') {
    if (tab === activeTab) return;
    messageStore.setActiveTab(sessionId, tab);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Alt+1 / Alt+2 / Alt+3 to switch tabs
    if (e.altKey && e.key === '1') { e.preventDefault(); switchTab('activity'); }
    if (e.altKey && e.key === '2' && !hasOrch) { e.preventDefault(); switchTab('changes'); }
    if (e.altKey && e.key === '2' && hasOrch) { e.preventDefault(); switchTab('plan'); }
    if (e.altKey && e.key === '3' && hasOrch) { e.preventDefault(); switchTab('plan'); }
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);

    // Replay history BEFORE subscribing to live events to avoid duplicates.
    // Events emitted during the tiny gap between replay and subscribe are
    // negligible and far less disruptive than duplicate messages.
    if (!messageStore.getIsReady(sessionId)) {
      try {
        const history = await window.groveBench.getEventHistory(sessionId);
        // Skip transient events during replay — partial_text is superseded by
        // assistant_text, and activity/tool_progress are ephemeral status updates.
        const skipDuringReplay = new Set([
          'partial_text', 'activity', 'tool_progress', 'usage',
        ]);
        for (const event of history) {
          if (!skipDuringReplay.has(event.type)) {
            messageStore.ingestEvent(sessionId, event);
          }
        }
        if (history.length > 0) {
          const last = history[history.length - 1];
          if (last.type === 'result' || last.type === 'process_exit') {
            messageStore.isRunning[sessionId] = false;
          }
        }
        // After replay, resolve any tool_calls still marked pending
        messageStore.resolveStaleToolCalls(sessionId);
      } catch (e: any) {
        messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] history replay failed: ${e?.message || e}` } as any);
      }
    }

    // Subscribe to live events only after history is replayed
    messageStore.subscribe(sessionId);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    messageStore.unsubscribe(sessionId);
  });
</script>

<div class="flex flex-col h-full bg-background">
  <!-- Tab bar -->
  <div class="flex items-center border-b border-border bg-card/50 shrink-0">
    <button
      onclick={() => switchTab('activity')}
      class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'activity'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/></svg>
      Activity
      {#if hasPendingPermission}
        <span class="inline-block w-2 h-2 bg-orange-500 animate-pulse"></span>
      {:else if isRunning}
        <span class="inline-block w-2 h-2 bg-primary animate-pulse"></span>
      {/if}
      <span class="text-muted-foreground/60 ml-1">Alt+1</span>
    </button>
    {#if !hasOrch}
      <button
        onclick={() => switchTab('changes')}
        class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'changes'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
        Changes
        {#if hasChanges}
          <span class="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none font-bold">
            {fileChanges.length}
          </span>
        {/if}
        <span class="text-muted-foreground/60 ml-1">Alt+2</span>
      </button>
    {/if}
    {#if hasOrch}
      <button
        onclick={() => switchTab('plan')}
        class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'plan'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
        Plan
        {#if totalCount > 0}
          <span class="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none font-bold">
            {completedCount}/{totalCount}
          </span>
        {:else if orchJob?.status === 'planning'}
          <span class="inline-block w-2 h-2 bg-blue-500 animate-pulse"></span>
        {/if}
        <span class="text-muted-foreground/60 ml-1">Alt+3</span>
      </button>

    {/if}
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
    <OutputPanel {sessionId} />
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'changes' ? '' : 'hidden'}">
    <ChangesReviewPanel {sessionId} />
  </div>
  {#if hasOrch}
    <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'plan' ? '' : 'hidden'}">
      {#if hasPlan && orchJob}
        <!-- Progress bar -->
        <div class="px-4 py-2 border-b border-border bg-card shrink-0">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs text-muted-foreground truncate" title={orchJob.goal}>{orchJob.goal}</p>
            <span class="text-xs text-muted-foreground shrink-0 ml-2">{completedCount}/{totalCount} tasks</span>
          </div>
          <div class="h-1.5 bg-muted overflow-hidden">
            <div
              class="h-full transition-all duration-500 ease-out {orchJob.status === 'failed' || orchJob.status === 'partial_failure' ? 'bg-red-500' : orchJob.status === 'completed' ? 'bg-green-500' : 'bg-primary'}"
              style="width: {progressPct}%"
            ></div>
          </div>
        </div>

        <!-- Kanban board -->
        <div class="pixel-bg flex-1 overflow-auto p-3 relative">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <div class="flex gap-3 h-full min-h-0 relative z-10">
            {#each columns as col (col.key)}
              {@const colTasks = tasksForColumn(col)}
              <div class="flex-1 flex flex-col min-w-[180px]">
                <div class="flex items-center gap-2 px-2 py-1.5 mb-2 border-b-2 {col.color}">
                  <span class="w-2 h-2 shrink-0 {col.dotClass}"></span>
                  <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{col.label}</span>
                  {#if colTasks.length > 0}
                    <span class="text-xs text-muted-foreground/60 ml-auto">{colTasks.length}</span>
                  {/if}
                </div>

                <div class="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0 pr-1">
                  {#each colTasks as task (task.id)}
                    <div class="border border-border bg-card p-2.5 hover:border-muted-foreground/30 transition-colors group">
                      <p class="text-sm font-medium text-foreground mb-1 leading-snug">{task.description}</p>
                      <p class="text-xs text-muted-foreground font-mono truncate mb-1.5" title={task.branchName}>
                        {task.branchName.split('/').pop()}
                      </p>

                      {#if task.dependsOn.length > 0}
                        <div class="flex items-center gap-1 mb-1.5 text-xs text-muted-foreground/70">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          <span class="truncate" title={depNames(task)}>{depNames(task)}</span>
                        </div>
                      {/if}

                      {#if task.scope.length > 0}
                        <div class="flex flex-wrap gap-1 mb-1.5">
                          {#each task.scope.slice(0, 2) as s}
                            <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground font-mono">{s.split('/').pop()}</span>
                          {/each}
                          {#if task.scope.length > 2}
                            <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground">+{task.scope.length - 2}</span>
                          {/if}
                        </div>
                      {/if}

                      {#if task.error}
                        <div class="text-xs text-destructive mb-1.5 line-clamp-2">{task.error}</div>
                      {/if}

                      <div class="flex items-center justify-between mt-1 pt-1 border-t border-border/50">
                        <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {#if task.costUsd !== null}
                            <span>${task.costUsd.toFixed(4)}</span>
                          {/if}
                          {#if elapsed(task)}
                            <span>{elapsed(task)}</span>
                          {/if}
                          {#if task.status === 'running' || task.status === 'spawning'}
                            <span class="flex items-center gap-1">
                              <span class="w-1 h-1 bg-blue-500 animate-pulse"></span>
                              {task.status === 'spawning' ? 'Starting...' : 'Active'}
                            </span>
                          {/if}
                        </div>
                        <div class="flex items-center gap-1">
                          {#if task.sessionId}
                            <button
                              onclick={() => focusTask(task.sessionId)}
                              class="text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              View
                            </button>
                          {/if}
                          {#if task.status === 'failed' || task.status === 'cancelled'}
                            <Button
                              variant="secondary"
                              size="sm"
                              class="h-5 text-[10px] px-1.5"
                              onclick={() => handleRetry(task.id)}
                              disabled={retrying === task.id}
                            >
                              {retrying === task.id ? '...' : 'Retry'}
                            </Button>
                          {/if}
                        </div>
                      </div>
                    </div>
                  {:else}
                    <div class="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 min-h-[60px]">
                      No tasks
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        {#if orchJob.status === 'planned'}
          <div class="mx-3 mb-3 p-3 border border-primary/30 bg-primary/5 shrink-0">
            <div class="flex items-center justify-between">
              <div class="text-sm text-foreground">
                Plan ready — <span class="text-muted-foreground">{totalCount} task{totalCount !== 1 ? 's' : ''} to launch</span>
              </div>
              <div class="flex items-center gap-2">
                {#if approving}
                  <Button size="sm" disabled>Launching...</Button>
                {:else}
                  <Button size="sm" onclick={handleApprove}>
                    Approve & Launch
                  </Button>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <!-- Footer summary -->
        <div class="px-4 py-2 border-t border-border bg-card shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <div class="flex items-center gap-3">
            <span>Status: <span class="text-foreground">{orchJob.status}</span></span>
            {#if orchJob.planDurationMs}
              <span>Plan: {(orchJob.planDurationMs / 1000).toFixed(1)}s</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if totalCost > 0}
              <span>Total cost: ${totalCost.toFixed(4)}</span>
            {/if}
            {#if failedTasks.length > 0}
              <Button
                variant="secondary"
                size="sm"
                class="h-5 text-[10px] px-1.5"
                onclick={handleRetryAll}
                disabled={retryingAll}
              >
                {retryingAll ? 'Retrying...' : `Retry All (${failedTasks.length})`}
              </Button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <div class="text-center relative z-10">
            {#if orchJob?.status === 'planning'}
              <div class="w-4 h-4 bg-primary animate-pulse mx-auto mb-2"></div>
              <p class="text-sm">Planning in progress...</p>
              <p class="text-xs mt-1">Switch to Activity to see the agent working</p>
            {:else}
              <p class="text-sm">No plan yet</p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <StatusBar {sessionId} />
  {#if activeTab === 'activity'}
    <PromptEditor {sessionId} />
  {:else}
    <div class="border-t border-border bg-card/50 px-4 py-2 shrink-0">
      <button
        onclick={() => switchTab('activity')}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Switch to Activity to send messages (Alt+1)
      </button>
    </div>
  {/if}
</div>
