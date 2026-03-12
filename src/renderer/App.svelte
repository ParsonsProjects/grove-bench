<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import { messageStore } from './stores/messages.svelte.js';
  import Sidebar from './components/Sidebar.svelte';
  import WorkspacePane from './components/WorkspacePane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';
  import SessionFinder from './components/SessionFinder.svelte';

  async function restoreWorktrees() {
    const runningSessions = await window.groveBench.listSessions();
    const runningIds = new Set(runningSessions.filter((s) => s.status === 'running').map((s) => s.id));

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

          const isRunning = runningIds.has(wt.id);
          store.addSession({
            id: wt.id,
            branch: wt.branch,
            repoPath: repo,
            status: isRunning ? 'running' : 'stopped',
            direct: wt.direct,
          });

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

    // After restoring all sessions, select the first running one
    const firstRunning = store.sessions.find((s) => s.status === 'running');
    if (firstRunning) {
      store.activeSessionId = firstRunning.id;
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
</script>

<PrerequisiteCheck />

<div class="flex h-screen bg-background text-foreground font-mono">
  <Sidebar />

  <main class="flex-1 flex flex-col min-w-0 min-h-0">
    {#if store.sessions.length === 0}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <p class="text-sm mb-2">No active agents</p>
          <p class="text-xs">Add a repository and create an agent to get started.</p>
        </div>
      </div>
    {:else if !store.activeSession}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <p class="text-sm mb-2">No open sessions</p>
          <p class="text-xs">Click a session in the sidebar to open it.</p>
        </div>
      </div>
    {:else}
      <!-- Tab bar -->
      {@const openSessions = store.sessions.filter((s) => s.status === 'running')}
      {#if openSessions.length > 0}
        <div class="flex items-center bg-card border-b border-border shrink-0">
          {#each openSessions as session (session.id)}
            {@const isActive = store.activeSessionId === session.id}
            {@const running = messageStore.getIsRunning(session.id)}
            {@const hasPending = messageStore.getMessages(session.id).some((m) => m.kind === 'permission' && !m.resolved)}
            {@const needsAttention = !isActive && !running && (sessionCompletedWhileInactive[session.id] ?? false)}
            {@const isDragOver = dropTargetId === session.id && dragTabId !== session.id}
            <button
              draggable="true"
              ondragstart={(e) => handleTabDragStart(e, session.id)}
              ondragover={(e) => handleTabDragOver(e, session.id)}
              ondrop={(e) => handleTabDrop(e, session.id)}
              ondragend={handleTabDragEnd}
              ondragleave={() => { if (dropTargetId === session.id) dropTargetId = null; }}
              onclick={() => { store.activeSessionId = session.id; delete sessionCompletedWhileInactive[session.id]; }}
              class="flex items-center gap-2 px-3 py-1.5 text-xs border-r border-border last:border-r-0 transition-colors group/tab
                {isActive ? 'bg-background text-foreground/80 border-b-2 border-b-primary' : 'bg-card text-muted-foreground hover:text-foreground border-b-2 border-b-transparent'}
                {dragTabId === session.id ? 'opacity-40' : ''}
                {isDragOver ? 'border-l-2 border-l-primary' : ''}"
            >
              {#if !isActive && running}
                <span class="w-3 h-3 shrink-0 border-[1.5px] border-primary border-t-transparent rounded-full animate-spin"></span>
              {:else if !isActive && hasPending}
                <span class="w-1.5 h-1.5 shrink-0 bg-amber-500 animate-pulse rounded-full"></span>
              {:else if needsAttention}
                <span class="w-1.5 h-1.5 shrink-0 bg-green-400 tab-flash rounded-full"></span>
              {:else}
                <span class="w-1.5 h-1.5 shrink-0 {running ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
              {/if}
              {#if store.repos.length > 1}
                <span class="truncate">{store.repoDisplayName(session.repoPath)}</span>
                <span class="text-muted-foreground/40">/</span>
              {/if}
              <span class="truncate">{session.branch}</span>
              <span
                role="button"
                tabindex="-1"
                onclick={(e) => { e.stopPropagation(); closeTab(session.id); }}
                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); closeTab(session.id); } }}
                class="ml-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity cursor-pointer"
              >&times;</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Active session -->
      {#each store.sessions as session (session.id)}
        <div class="flex-1 min-h-0" class:hidden={store.activeSessionId !== session.id}>
          {#if session.status === 'running'}
            <WorkspacePane sessionId={session.id} />
          {:else}
            <div class="flex items-center justify-center h-full text-muted-foreground">
              <div class="w-5 h-5 border-2 border-border border-t-transparent animate-spin"></div>
              <span class="ml-3 text-sm">Starting agent...</span>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </main>
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
