<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import { messageStore } from './stores/messages.svelte.js';
  import Sidebar from './components/Sidebar.svelte';
  import WorkspacePane from './components/WorkspacePane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';
  import SessionFinder from './components/SessionFinder.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import { orchStore } from './stores/orchestration.svelte.js';

  async function restoreWorktrees() {
    const runningSessions = await window.groveBench.listSessions();
    const runningMap = new Map(runningSessions.filter((s) => s.status === 'running').map((s) => [s.id, s]));

    for (const repo of [...store.repos]) {
      try {
        const valid = await window.groveBench.validateRepo(repo);
        if (!valid) {
          store.removeRepo(repo);
          continue;
        }
        const worktrees = await window.groveBench.listWorktrees(repo);
        for (const wt of worktrees) {
          if (store.sessions.find((s) => s.id === wt.id)) continue;

          const runningSession = runningMap.get(wt.id);
          const isRunning = !!runningSession;
          const isChild = !!runningSession?.parentSessionId;
          store.addSession({
            id: wt.id,
            branch: wt.branch,
            repoPath: repo,
            status: isRunning ? 'running' : 'stopped',
            direct: wt.direct,
            parentSessionId: runningSession?.parentSessionId ?? null,
            orchJobId: runningSession?.orchJobId ?? null,
          }, false); // don't focus during restore — selection happens after orch patching

          if (isRunning) {
            // Just reattach the window — history replay and subscription
            // are handled by WorkspacePane when it mounts.
            window.groveBench.resumeSession(wt.id, repo).catch((e: any) => {
              store.setError(e.message || String(e));
            });
          }
        }
      } catch {
        store.removeRepo(repo);
      }
    }

    // Load persisted orchestration jobs and restore their sidebar sessions
    await orchStore.loadPersistedJobs();
    for (const job of orchStore.jobs) {
      // Restore the planning session
      if (job.planSessionId && !store.sessions.find((s) => s.id === job.planSessionId)) {
        const isRunning = runningMap.has(job.planSessionId);
        store.addSession({
          id: job.planSessionId,
          branch: `orch: ${job.goal.slice(0, 40)}`,
          repoPath: job.repoPath,
          status: isRunning ? 'running' : 'stopped',
          orchJobId: job.id,
        }, false);
        messageStore.setModeLocal(job.planSessionId, 'orchestrator');
      }

      // Link subtask sessions back to their orch job
      for (const task of job.tasks) {
        if (!task.sessionId) continue;
        const existing = store.sessions.find((s) => s.id === task.sessionId);
        if (existing) {
          // Patch in the parent/orch relationship that was lost on refresh
          existing.parentSessionId = job.planSessionId;
        }
      }
    }

    // Now that orch relationships are patched, select the best session:
    // 1. First running top-level session (non-child)
    // 2. First active orch (running/spawning/merging job) orchestrator session
    // 3. First top-level session
    const activeOrchJobIds = new Set(
      orchStore.jobs
        .filter((j) => j.status === 'running' || j.status === 'spawning' || j.status === 'merging')
        .map((j) => j.id)
    );
    const firstRunning = store.sessions.find((s) => s.status === 'running' && !s.parentSessionId);
    const firstActiveOrch = store.sessions.find((s) => s.orchJobId && activeOrchJobIds.has(s.orchJobId));
    const firstTopLevel = store.sessions.find((s) => !s.parentSessionId);
    const best = firstRunning ?? firstActiveOrch ?? firstTopLevel;
    if (best) {
      store.activeSessionId = best.id;
    }
  }

  let showSessionFinder = $state(false);

  // Track which inactive tabs had a turn complete
  let sessionCompletedWhileInactive = $state<Record<string, boolean>>({});
  let prevRunningState = $state<Record<string, boolean>>({});

  // Detect when a non-active session transitions from running → idle
  $effect(() => {
    for (const session of store.sessions) {
      const running = messageStore.getIsRunning(session.id);
      const wasRunning = prevRunningState[session.id] ?? false;
      if (wasRunning && !running && store.activeSessionId !== session.id) {
        sessionCompletedWhileInactive[session.id] = true;
      }
      prevRunningState[session.id] = running;
    }
  });

  // Clear flash when switching to a session
  $effect(() => {
    const activeId = store.activeSessionId;
    if (activeId && sessionCompletedWhileInactive[activeId]) {
      delete sessionCompletedWhileInactive[activeId];
    }
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      showSessionFinder = !showSessionFinder;
    }
  }

  let resumingId: string | null = null;
  let failedResumeIds = new Set<string>();

  $effect(() => {
    const session = store.activeSession;
    if (!session || session.status !== 'stopped' || resumingId === session.id || failedResumeIds.has(session.id)) return;
    // Orchestrator planning sessions don't have worktrees and can't be resumed
    if (session.orchJobId) return;

    resumingId = session.id;
    const sessionId = session.id;
    window.groveBench.resumeSession(session.id, session.repoPath).then((result) => {
      store.updateStatus(result.id, 'running');
      messageStore.subscribe(result.id);
      failedResumeIds.delete(sessionId);
    }).catch((e: any) => {
      store.setError(e.message || String(e));
      failedResumeIds.add(sessionId);
    }).finally(() => {
      resumingId = null;
    });
  });

  // Tab drag-and-drop reordering
  let dragTabId = $state<string | null>(null);
  let dropTargetId = $state<string | null>(null);

  function handleTabDragStart(e: DragEvent, id: string) {
    dragTabId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }

  function handleTabDragOver(e: DragEvent, id: string) {
    if (!dragTabId || dragTabId === id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropTargetId = id;
  }

  function handleTabDrop(e: DragEvent, id: string) {
    e.preventDefault();
    if (dragTabId && dragTabId !== id) {
      store.reorderSession(dragTabId, id);
    }
    dragTabId = null;
    dropTargetId = null;
  }

  function handleTabDragEnd() {
    dragTabId = null;
    dropTargetId = null;
  }

  async function closeTab(id: string) {
    try {
      await window.groveBench.stopSession(id);
    } catch { /* session may already be dead */ }
    store.updateStatus(id, 'stopped');
    if (store.activeSessionId === id) {
      const next = store.sessions.find((s) => s.id !== id && s.status === 'running');
      store.activeSessionId = next?.id ?? null;
    }
  }

  onMount(() => {
    restoreWorktrees();
    window.addEventListener('keydown', handleGlobalKeydown);

    const unsub = window.groveBench.onSessionStatus((sessionId, status) => {
      store.updateStatus(sessionId, status);
    });
    return () => {
      unsub();
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

  let openSessions = $derived(store.sessions.filter((s) => s.status === 'running' || s.orchJobId));
  let hasTabContent = $derived(openSessions.length > 0);
</script>

<PrerequisiteCheck />

<div class="flex flex-col h-screen bg-background text-foreground font-mono">
<TitleBar />
<div class="flex flex-1 min-h-0">
  <Sidebar />

  <main class="flex-1 flex flex-col min-w-0 min-h-0">
    {#if !hasTabContent && store.sessions.length === 0}
      <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
        {#each Array(20) as _, i}
          <span
            class="blue-pixel absolute rounded-[1px]"
            style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
          ></span>
        {/each}
        <div class="text-center relative z-10">
          <p class="text-sm mb-2">No active agents</p>
          <p class="text-xs">Add a repository and create an agent to get started.</p>
        </div>
      </div>
    {:else if !hasTabContent}
      <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
        {#each Array(20) as _, i}
          <span
            class="blue-pixel absolute rounded-[1px]"
            style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
          ></span>
        {/each}
        <div class="text-center relative z-10">
          <p class="text-sm mb-2">No open sessions</p>
          <p class="text-xs">Click a session in the sidebar to open it.</p>
        </div>
      </div>
    {:else}
      <!-- Tab bar -->
      <div class="flex items-center bg-card border-b border-border shrink-0 overflow-x-auto">
        {#each openSessions as session (session.id)}
          {@const isActive = store.activeSessionId === session.id}
          {@const running = messageStore.getIsRunning(session.id)}
          {@const hasPending = messageStore.getMessages(session.id).some((m) => m.kind === 'permission' && !m.resolved)}
          {@const needsAttention = !isActive && !running && (sessionCompletedWhileInactive[session.id] ?? false)}
          {@const isDragOver = dropTargetId === session.id && dragTabId !== session.id}
          {@const orchJob = session.orchJobId ? orchStore.jobs.find(j => j.id === session.orchJobId) : null}
          <button
            draggable="true"
            ondragstart={(e) => handleTabDragStart(e, session.id)}
            ondragover={(e) => handleTabDragOver(e, session.id)}
            ondrop={(e) => handleTabDrop(e, session.id)}
            ondragend={handleTabDragEnd}
            ondragleave={() => { if (dropTargetId === session.id) dropTargetId = null; }}
            onclick={() => { store.activeSessionId = session.id; delete sessionCompletedWhileInactive[session.id]; }}
            class="flex items-center gap-2 px-3 py-1.5 text-xs border-r border-border last:border-r-0 transition-colors group/tab shrink-0
              {isActive ? 'bg-background text-foreground/80 border-b-2 border-b-primary' : 'bg-card text-muted-foreground hover:text-foreground border-b-2 border-b-transparent'}
              {dragTabId === session.id ? 'opacity-40' : ''}
              {isDragOver ? 'border-l-2 border-l-primary' : ''}"
          >
            {#if !isActive && running}
              <span class="w-2 h-2 shrink-0 bg-primary animate-pulse"></span>
            {:else if !isActive && hasPending}
              <span class="w-1.5 h-1.5 shrink-0 bg-amber-500 animate-pulse"></span>
            {:else if needsAttention}
              <span class="w-1.5 h-1.5 shrink-0 bg-green-400 tab-flash rounded-full"></span>
            {:else}
              <span class="w-1.5 h-1.5 shrink-0 {running ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
            {/if}
            {#if orchJob}
              <svg class="w-3 h-3 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/><path d="m4.2 4.2 2.8 2.8"/><path d="m17 17 2.8 2.8"/><path d="m4.2 19.8 2.8-2.8"/><path d="m17 7 2.8-2.8"/></svg>
            {/if}
            {#if store.repos.length > 1}
              <span class="truncate">{store.repoDisplayName(session.repoPath)}</span>
              <span class="text-muted-foreground/40">/</span>
            {/if}
            <span class="truncate">{session.branch}</span>
            {#if orchJob && orchJob.tasks.length > 0}
              <span class="text-[10px] text-muted-foreground/60 shrink-0">{orchJob.tasks.filter(t => t.status === 'completed').length}/{orchJob.tasks.length}</span>
            {/if}
            <span
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); closeTab(session.id); }}
              onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); closeTab(session.id); } }}
              class="ml-1 w-4 h-4 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted opacity-0 group-hover/tab:opacity-100 transition-all cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </span>
          </button>
        {/each}
      </div>

      <!-- Active session -->
      {#if store.activeSessionId}
        <!-- Active session -->
        {#each store.sessions as session (session.id)}
          <div class="flex-1 min-h-0" class:hidden={store.activeSessionId !== session.id}>
            {#if session.status === 'running' || session.orchJobId}
              <WorkspacePane sessionId={session.id} />
            {:else}
              <div class="pixel-bg flex items-center justify-center h-full text-muted-foreground relative overflow-hidden">
                {#each Array(20) as _, i}
                  <span
                    class="blue-pixel absolute rounded-[1px]"
                    style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
                  ></span>
                {/each}
                <div class="w-4 h-4 bg-primary animate-pulse relative z-10"></div>
                <span class="ml-3 text-sm relative z-10">Starting agent...</span>
              </div>
            {/if}
          </div>
        {/each}
      {:else}
        <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
          {#each Array(20) as _, i}
            <span
              class="blue-pixel absolute rounded-[1px]"
              style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
            ></span>
          {/each}
          <div class="text-center relative z-10">
            <p class="text-sm">Select a tab to view</p>
          </div>
        </div>
      {/if}
    {/if}
  </main>
</div>
</div>

{#if showSessionFinder}
  <SessionFinder onclose={() => showSessionFinder = false} />
{/if}

<ErrorToast />

<style>
  :global(.tab-flash) {
    animation: tab-flash 0.8s ease-in-out infinite;
  }
  @keyframes tab-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
</style>
