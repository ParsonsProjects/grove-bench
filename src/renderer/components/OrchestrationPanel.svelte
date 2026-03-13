<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import OutputPanel from './OutputPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';
  import type { OrchTask, OrchTaskStatus } from '../../shared/types.js';

  let { jobId }: { jobId: string } = $props();

  let job = $derived(orchStore.jobs.find((j) => j.id === jobId));
  let cancelling = $state(false);
  let retrying = $state<string | null>(null);
  let merging = $state(false);
  let resolvingConflict = $state<string | null>(null);
  let activeTab = $state<'activity' | 'plan'>('activity');

  // Plan session setup
  let planSessionId = $derived(job?.planSessionId ?? null);
  let isPlanning = $derived(job?.status === 'planning');
  let hasPlan = $derived((job?.tasks.length ?? 0) > 0);
  let approving = $state(false);

  // Auto-switch to plan tab when planning completes
  $effect(() => {
    if (hasPlan && activeTab === 'activity' && job?.status === 'planned') {
      activeTab = 'plan';
    }
  });

  // Mount/unmount the plan session's message subscription
  onMount(() => {
    if (planSessionId && !messageStore.getIsReady(planSessionId)) {
      window.groveBench.getEventHistory(planSessionId).then((history) => {
        const skipDuringReplay = new Set(['partial_text', 'activity', 'tool_progress', 'usage']);
        for (const event of history) {
          if (!skipDuringReplay.has(event.type)) {
            messageStore.ingestEvent(planSessionId!, event);
          }
        }
        if (history.length > 0) {
          const last = history[history.length - 1];
          if (last.type === 'result' || last.type === 'process_exit') {
            messageStore.isRunning[planSessionId!] = false;
          }
        }
        messageStore.resolveStaleToolCalls(planSessionId!);
      }).catch(() => {});
      messageStore.subscribe(planSessionId);
    }
  });

  onDestroy(() => {
    if (planSessionId) {
      messageStore.unsubscribe(planSessionId);
    }
  });

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
    { key: 'blocked', label: 'Failed', statuses: ['failed', 'cancelled', 'merge_conflict'], color: 'border-red-500/40', dotClass: 'bg-red-500' },
  ];

  function tasksForColumn(col: KanbanColumn): OrchTask[] {
    if (!job) return [];
    return job.tasks.filter((t) => col.statuses.includes(t.status));
  }

  function focusTask(sessionId: string | null) {
    if (!sessionId) return;
    store.activeSessionId = sessionId;
    orchStore.activeJobId = null;
  }

  async function handleCancel() {
    if (!job) return;
    cancelling = true;
    try {
      await window.groveBench.cancelOrchJob(job.id);
      for (const task of job.tasks) {
        if (task.status === 'running' || task.status === 'spawning' || task.status === 'pending') {
          orchStore.updateTaskStatus(job.id, task.id, 'cancelled');
        }
      }
      orchStore.updateJob(job.id, { status: 'cancelled', completedAt: Date.now() });
    } catch { /* best effort */ }
    cancelling = false;
  }

  async function handleApprove() {
    if (!job) return;
    approving = true;
    try {
      const edits = job.tasks.map((t) => ({
        id: t.id,
        instruction: t.instruction,
        description: t.description,
        branchName: t.branchName,
      }));
      await window.groveBench.approveOrchPlan(job.id, edits);
      orchStore.subscribe(job.id);
    } catch { /* best effort */ }
    approving = false;
  }

  async function handleRetry(taskId: string) {
    if (!job) return;
    retrying = taskId;
    try {
      await window.groveBench.retryOrchTask(job.id, taskId);
    } catch { /* best effort */ }
    retrying = null;
  }

  async function handleMerge() {
    if (!job) return;
    merging = true;
    try {
      await window.groveBench.mergeOrchJob(job.id);
    } catch { /* best effort */ }
    merging = false;
  }

  async function handleResolveConflict(taskId: string) {
    if (!job) return;
    resolvingConflict = taskId;
    try {
      await window.groveBench.resolveOrchConflict(job.id, taskId);
    } catch { /* best effort */ }
    resolvingConflict = null;
  }

  function depNames(task: OrchTask): string {
    if (!job || task.dependsOn.length === 0) return '';
    return task.dependsOn
      .map((depId) => {
        const dep = job!.tasks.find((t) => t.id === depId);
        return dep ? dep.description.slice(0, 20) : depId;
      })
      .join(', ');
  }

  function elapsed(task: OrchTask): string {
    if (task.durationMs !== null && task.durationMs !== undefined) {
      if (task.durationMs < 60_000) return `${(task.durationMs / 1000).toFixed(0)}s`;
      return `${(task.durationMs / 60_000).toFixed(1)}m`;
    }
    if (!task.completedAt || !task.startedAt) return '';
    const ms = task.completedAt - task.startedAt;
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  function mergeStatusIcon(task: OrchTask): string {
    if (task.mergeStatus === 'merged') return 'bg-green-500';
    if (task.mergeStatus === 'conflict') return 'bg-red-500';
    return '';
  }

  let completedCount = $derived(job?.tasks.filter((t) => t.status === 'completed').length ?? 0);
  let totalCount = $derived(job?.tasks.length ?? 0);
  let totalCost = $derived(
    job?.tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) ?? 0
  );
  let isTerminal = $derived(
    job?.status === 'completed' || job?.status === 'failed' || job?.status === 'partial_failure' || job?.status === 'cancelled'
  );
  let isMerging = $derived(job?.status === 'merging');
  let hasOverlapWarnings = $derived((job?.overlapWarnings?.length ?? 0) > 0);
  let hasConflicts = $derived(job?.tasks.some(t => t.mergeStatus === 'conflict') ?? false);
  let canMerge = $derived(
    isTerminal && completedCount > 0 && !isMerging
  );
  let progressPct = $derived(totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
  let planIsRunning = $derived(planSessionId ? messageStore.getIsRunning(planSessionId) : false);
</script>

{#if job}
  <div class="flex flex-col h-full bg-background">
    <!-- Sub-tab bar -->
    <div class="flex items-center border-b border-border bg-card/50 shrink-0">
      <button
        onclick={() => activeTab = 'activity'}
        class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'activity'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/></svg>
        Activity
        {#if planIsRunning}
          <span class="inline-block w-2 h-2 bg-primary animate-pulse"></span>
        {/if}
      </button>
      <button
        onclick={() => activeTab = 'plan'}
        class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'plan'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
        Plan
        {#if totalCount > 0}
          <span class="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none font-bold">
            {completedCount}/{totalCount}
          </span>
        {:else if isPlanning}
          <span class="inline-block w-2 h-2 bg-blue-500 animate-pulse"></span>
        {/if}
      </button>

      <!-- Right-side controls -->
      <div class="ml-auto flex items-center gap-2 pr-3">
        {#if job.status === 'planned' && !approving}
          <Button size="sm" onclick={handleApprove}>
            Approve & Launch ({totalCount} tasks)
          </Button>
        {:else if approving}
          <Button size="sm" disabled>Launching...</Button>
        {/if}
        {#if canMerge}
          <Button
            size="sm"
            onclick={handleMerge}
            disabled={merging}
          >
            {merging ? 'Merging...' : hasConflicts ? 'Re-merge' : 'Merge All'}
          </Button>
        {/if}
        {#if isMerging}
          <Button size="sm" disabled>
            <span class="w-2 h-2 bg-primary animate-pulse mr-1.5"></span>
            Merging...
          </Button>
        {/if}
        {#if !isTerminal && !isMerging}
          <Button
            variant="destructive"
            size="sm"
            onclick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </Button>
        {/if}
      </div>
    </div>

    <!-- Activity tab: chat interface -->
    <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
      {#if planSessionId}
        <OutputPanel sessionId={planSessionId} />
        <StatusBar sessionId={planSessionId} />
        <PromptEditor sessionId={planSessionId} />
      {:else}
        <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute rounded-[1px]"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <p class="text-sm relative z-10">No planning session</p>
        </div>
      {/if}
    </div>

    <!-- Plan tab: kanban board -->
    <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'plan' ? '' : 'hidden'}">
      {#if hasPlan}
        <!-- Overlap warnings -->
        {#if hasOverlapWarnings && job.overlapWarnings}
          <div class="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 shrink-0">
            <div class="flex items-center gap-2 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-yellow-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <span class="text-xs font-medium text-yellow-600 dark:text-yellow-400">Scope Overlap Detected</span>
            </div>
            {#each job.overlapWarnings as warning}
              <p class="text-[10px] text-yellow-600/80 dark:text-yellow-400/70 ml-5">
                {job.tasks.find(t => t.id === warning.taskA)?.description ?? warning.taskA}
                &harr;
                {job.tasks.find(t => t.id === warning.taskB)?.description ?? warning.taskB}:
                <span class="font-mono">{warning.files.join(', ')}</span>
              </p>
            {/each}
          </div>
        {/if}

        <!-- Progress bar -->
        <div class="px-4 py-2 border-b border-border bg-card shrink-0">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs text-muted-foreground truncate" title={job.goal}>{job.goal}</p>
            <span class="text-xs text-muted-foreground shrink-0 ml-2">{completedCount}/{totalCount} tasks</span>
          </div>
          <div class="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full transition-all duration-500 ease-out rounded-full {job.status === 'failed' || job.status === 'partial_failure' ? 'bg-red-500' : job.status === 'completed' ? 'bg-green-500' : job.status === 'merging' ? 'bg-blue-500 animate-pulse' : 'bg-primary'}"
              style="width: {progressPct}%"
            ></div>
          </div>
        </div>

        <!-- Kanban board -->
        <div class="pixel-bg flex-1 overflow-auto p-3 relative">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute rounded-[1px]"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <div class="flex gap-3 h-full min-h-0 relative z-10">
            {#each columns as col (col.key)}
              {@const colTasks = tasksForColumn(col)}
              <div class="flex-1 flex flex-col min-w-[180px]">
                <div class="flex items-center gap-2 px-2 py-1.5 mb-2 border-b-2 {col.color}">
                  <span class="w-2 h-2 shrink-0 rounded-full {col.dotClass}"></span>
                  <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{col.label}</span>
                  {#if colTasks.length > 0}
                    <span class="text-xs text-muted-foreground/60 ml-auto">{colTasks.length}</span>
                  {/if}
                </div>

                <div class="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0 pr-1">
                  {#each colTasks as task (task.id)}
                    <div class="border border-border bg-card p-2.5 hover:border-muted-foreground/30 transition-colors group">
                      <div class="flex items-center gap-1.5 mb-1">
                        {#if task.mergeStatus}
                          <span class="w-2 h-2 shrink-0 rounded-full {mergeStatusIcon(task)}" title="Merge: {task.mergeStatus}"></span>
                        {/if}
                        <p class="text-sm font-medium text-foreground leading-snug">{task.description}</p>
                      </div>
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
                            <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground rounded-sm font-mono">{s.split('/').pop()}</span>
                          {/each}
                          {#if task.scope.length > 2}
                            <span class="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground rounded-sm">+{task.scope.length - 2}</span>
                          {/if}
                        </div>
                      {/if}

                      {#if task.error}
                        <div class="text-xs text-destructive mb-1.5 line-clamp-2">{task.error}</div>
                      {/if}

                      {#if task.mergeError}
                        <div class="text-xs text-orange-500 mb-1.5 line-clamp-2">{task.mergeError}</div>
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
                              <span class="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
                              {task.status === 'spawning' ? 'Starting...' : 'Active'}
                            </span>
                          {/if}
                          {#if task.mergeStatus === 'merged'}
                            <span class="text-green-500">Merged</span>
                          {:else if task.mergeStatus === 'conflict'}
                            <span class="text-orange-500">Conflict</span>
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
                          {#if task.mergeStatus === 'conflict'}
                            <Button
                              variant="secondary"
                              size="sm"
                              class="h-5 text-[10px] px-1.5"
                              onclick={() => handleResolveConflict(task.id)}
                              disabled={resolvingConflict === task.id}
                            >
                              {resolvingConflict === task.id ? '...' : 'Resolve'}
                            </Button>
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

        <!-- Footer summary -->
        <div class="px-4 py-2 border-t border-border bg-card shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <div class="flex items-center gap-3">
            <span>Status: <span class="text-foreground">{job.status}</span></span>
            {#if job.planDurationMs}
              <span>Plan: {(job.planDurationMs / 1000).toFixed(1)}s</span>
            {/if}
          </div>
          {#if totalCost > 0}
            <span>Total cost: ${totalCost.toFixed(4)}</span>
          {/if}
        </div>
      {:else}
        <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute rounded-[1px]"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <div class="text-center relative z-10">
            {#if isPlanning}
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
  </div>
{:else}
  <div class="flex items-center justify-center h-full text-muted-foreground text-sm">
    Job not found
  </div>
{/if}
