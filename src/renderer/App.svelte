<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import { messageStore } from './stores/messages.svelte.js';
  import { settingsStore } from './stores/settings.svelte.js';
  import { setAnalyticsEnabled, trackEvent } from './lib/analytics.js';
  import Sidebar from './components/Sidebar.svelte';
  import WorkspacePane from './components/WorkspacePane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';
  import SessionFinder from './components/SessionFinder.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import SessionContextMenu from './components/SessionContextMenu.svelte';
  import AnalyticsConsent from './components/AnalyticsConsent.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let showAnalyticsConsent = $state(false);

  let contextMenu = $state<{ x: number; y: number; sessionId: string } | null>(null);

  function openContextMenu(e: MouseEvent, sessionId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, sessionId };
  }

  function getContextMenuItems(sessionId: string) {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    return [
      { label: 'New Session', icon: 'add' as const, action: () => newSessionForRepo(session.repoPath, session.branch) },
      { label: 'Rename', icon: 'rename' as const, action: () => startTabRename(sessionId) },
      { label: 'Open Folder', icon: 'folder' as const, action: () => window.groveBench.openSessionFolder(sessionId) },
      { label: 'Close Tab', icon: 'close' as const, action: () => closeTab(sessionId), separator: true },
      { label: 'Destroy Agent', icon: 'destroy' as const, action: () => closeTab(sessionId), variant: 'destructive' as const },
    ];
  }

  async function newSessionForRepo(repoPath: string, branch: string) {
    try {
      const result = await window.groveBench.createSession({ repoPath, branchName: branch, direct: true });
      store.addSession({ id: result.id, branch: result.branch, repoPath, status: 'running', direct: true });
      store.activeSessionId = result.id;
    } catch (e: any) {
      store.setError(e.message || String(e));
    }
  }

  let tabRenamingId = $state<string | null>(null);
  let tabRenameValue = $state('');
  let tabRenameError = $state<string | null>(null);

  function startTabRename(sessionId: string) {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return;
    tabRenamingId = sessionId;
    tabRenameValue = session.displayName || session.branch;
    tabRenameError = null;
  }

  async function confirmTabRename() {
    if (!tabRenamingId) return;
    const newName = tabRenameValue.trim();
    if (!newName) { tabRenamingId = null; return; }
    const session = store.sessions.find(s => s.id === tabRenamingId);
    if (session && newName === (session.displayName || session.branch)) { tabRenamingId = null; return; }
    try {
      await window.groveBench.renameSession(tabRenamingId, newName);
      store.updateDisplayName(tabRenamingId, newName);
      tabRenamingId = null;
      tabRenameError = null;
    } catch (e: any) {
      tabRenameError = e.message || String(e);
    }
  }

  function handleRenameDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmTabRename(); }
  }

  /** Return '#n' suffix when multiple sessions share the same branch, empty string otherwise */
  function branchIndex(session: { id: string; repoPath: string; branch: string }): string {
    const siblings = store.sessionsForRepo(session.repoPath).filter(s => s.branch === session.branch);
    if (siblings.length <= 1) return '';
    const idx = siblings.findIndex(s => s.id === session.id);
    return `#${idx + 1} `;
  }

  let restored = $state(false);

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
          store.addSession({
            id: wt.id,
            branch: wt.branch,
            repoPath: repo,
            status: isRunning ? 'running' : 'stopped',
            direct: wt.direct,
            displayName: runningSession?.displayName ?? null,
          }, false);

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

    // Resume all previously-open tabs, not just the active one
    const persistedOpenTabs = await window.groveBench.getOpenTabs();
    for (const tabId of persistedOpenTabs) {
      const session = store.sessions.find((s) => s.id === tabId);
      if (session && session.status === 'stopped' && !runningMap.has(tabId)) {
        window.groveBench.resumeSession(tabId, session.repoPath).then((result) => {
          store.updateStatus(result.id, 'running');
        }).catch((e: any) => {
          store.setError(e.message || String(e));
          failedResumeIds.add(tabId);
        });
      }
    }

    // Restore persisted tab order
    if (persistedOpenTabs.length) {
      store.reorderByIds(persistedOpenTabs);
    }

    // Restore persisted active tab, or fall back to first running session
    const persistedTabId = await window.groveBench.getActiveTab();
    if (persistedTabId && store.sessions.find((s) => s.id === persistedTabId)) {
      store.activeSessionId = persistedTabId;
    } else {
      const firstRunning = store.sessions.find((s) => s.status === 'running');
      if (firstRunning) {
        store.activeSessionId = firstRunning.id;
      }
    }

    restored = true;
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

  // Persist active tab across restarts — skip until restore completes
  // to avoid overwriting the persisted value with null on hot reload
  $effect(() => {
    if (restored) {
      window.groveBench.setActiveTab(store.activeSessionId);
    }
  });

  // Persist open tab IDs so all tabs reopen on restart
  $effect(() => {
    if (restored) {
      const ids = store.sessions
        .filter((s) => s.status === 'running' || s.status === 'starting' || s.status === 'installing' || s.status === 'error')
        .map((s) => s.id);
      window.groveBench.setOpenTabs(ids);
    }
  });

  // Sync analytics opt-in/out when setting changes (no restart needed).
  // Also fires app_launched once after consent has been resolved.
  let appLaunchedTracked = false;
  $effect(() => {
    const { analyticsEnabled, analyticsPrompted } = settingsStore.current;
    setAnalyticsEnabled(analyticsEnabled);
    if (analyticsEnabled && analyticsPrompted && !appLaunchedTracked) {
      trackEvent('app_launched');
      appLaunchedTracked = true;
    }
  });

  // Show analytics consent banner on first launch
  $effect(() => {
    if (!settingsStore.loading && !settingsStore.current.analyticsPrompted) {
      showAnalyticsConsent = true;
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
      // Don't subscribe here — WorkspacePane handles history replay + subscription
      // on mount. Subscribing here would race with mount and cause isReady to be
      // set before history replay, resulting in an empty chat.
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
    const session = store.sessions.find((s) => s.id === id);
    // Remove from tab bar immediately (prevents flicker)
    if (store.activeSessionId === id) {
      const next = store.sessions.find((s) => s.id !== id && s.status === 'running');
      store.activeSessionId = next?.id ?? null;
    }

    store.updateStatus(id, 'stopped');
    try {
      await window.groveBench.stopSession(id);
    } catch { /* session may already be dead */ }
  }

  onMount(() => {
    settingsStore.load();
    store.loadRepos().then(() => restoreWorktrees());
    window.addEventListener('keydown', handleGlobalKeydown);

    const unsub = window.groveBench.onSessionStatus((sessionId, status) => {
      store.updateStatus(sessionId, status);
      if (status === 'running') {
        // SESSION_STATUS 'running' fires when system_init arrives on the main side.
        // Ensure the input unlocks even if system_init was missed due to a
        // subscribe/replay race. system_init will fill in model/tools info
        // when it arrives; this just guarantees the input is usable.
        messageStore.setIsReady(sessionId, true);
        messageStore.setIsRunning(sessionId, false);
      } else if (status === 'error') {
        messageStore.setIsReady(sessionId, true);
        messageStore.setIsRunning(sessionId, false);
      } else if (status === 'stopped') {
        // Session died (possibly during sleep) — update UI
        messageStore.markSessionStopped(sessionId);
      }
    });

    // After system resume (laptop wake), re-check session liveness.
    // The main process runs healthCheckAll() and sends SESSION_STATUS
    // for dead sessions, but we also re-verify subscriptions are live
    // by listing sessions and reconciling with our local state.
    const unsubPower = window.groveBench.onPowerResume(async () => {
      try {
        const runningSessions = await window.groveBench.listSessions();
        const runningIds = new Set(
          runningSessions.filter((s) => s.status === 'running').map((s) => s.id),
        );
        // Mark any locally-running sessions that the main process says are stopped
        for (const session of store.sessions) {
          if (session.status === 'running' && !runningIds.has(session.id)) {
            store.updateStatus(session.id, 'stopped');
            messageStore.markSessionStopped(session.id);
          }
        }
      } catch { /* main process may be busy — SESSION_STATUS events will catch up */ }
    });

    return () => {
      unsub();
      unsubPower();
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

  let openSessions = $derived(store.sessions.filter((s) => s.status === 'running' || s.status === 'starting' || s.status === 'installing' || s.status === 'error'));
  let hasTabContent = $derived(openSessions.length > 0);

  // Track pending permissions per session reactively via $derived so the tab
  // glow updates immediately when a permission is resolved.
  let pendingBySession = $derived(
    Object.fromEntries(openSessions.map((s) => [s.id, messageStore.hasPendingPermission(s.id)])),
  );
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
            class="blue-pixel absolute"
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
            class="blue-pixel absolute"
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
            onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(session.id); } }}
            oncontextmenu={(e) => openContextMenu(e, session.id)}
            class="flex items-center gap-2 px-3 py-1.5 text-xs border-r border-border last:border-r-0 transition-colors group/tab shrink-0
              {isActive ? 'bg-background text-foreground/80 border-b-2 border-b-primary' : 'bg-card text-muted-foreground hover:text-foreground border-b-2 border-b-transparent'}
              {pendingBySession[session.id] ? 'tab-action-required' : ''}
              {dragTabId === session.id ? 'opacity-40' : ''}
              {isDragOver ? 'border-l-2 border-l-primary' : ''}"
          >
            {#if session.status === 'error'}
              <span class="w-2 h-2 shrink-0 bg-red-500"></span>
            {:else if session.status === 'starting' || session.status === 'installing'}
              <span class="w-2 h-2 shrink-0 bg-yellow-500 animate-pulse"></span>
            {:else if pendingBySession[session.id]}
              <span class="w-2 h-2 shrink-0 bg-orange-500 animate-pulse"></span>
            {:else if !isActive && running}
              <span class="w-2 h-2 shrink-0 bg-primary animate-pulse"></span>
            {:else if needsAttention}
              <span class="w-1.5 h-1.5 shrink-0 bg-green-400 tab-flash"></span>
            {:else}
              <span class="w-1.5 h-1.5 shrink-0 {running ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
            {/if}
            {#if store.repos.length > 1}
              <span class="truncate">{store.repoDisplayName(session.repoPath)}</span>
              <span class="text-muted-foreground/40">/</span>
            {/if}
            <span class="truncate">{session.displayName || (branchIndex(session) + session.branch)}</span>
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
            {#if session.status === 'running' || session.status === 'starting' || session.status === 'installing' || session.status === 'error'}
              <WorkspacePane sessionId={session.id} />
            {:else}
              <div class="pixel-bg flex items-center justify-center h-full text-muted-foreground relative overflow-hidden">
                {#each Array(20) as _, i}
                  <span
                    class="blue-pixel absolute"
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
              class="blue-pixel absolute"
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

{#if contextMenu}
  <SessionContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems(contextMenu.sessionId)}
    onclose={() => contextMenu = null}
  />
{/if}

{#if tabRenamingId}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) tabRenamingId = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Rename Agent</Dialog.Title>
      </Dialog.Header>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={tabRenameValue}
        onkeydown={handleRenameDialogKeydown}
        class="w-full text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
        autofocus
      />
      {#if tabRenameError}
        <span class="text-xs text-destructive">{tabRenameError}</span>
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => tabRenamingId = null}>Cancel</Button>
        <Button onclick={confirmTabRename}>Rename</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<AnalyticsConsent visible={showAnalyticsConsent} />

<style>
  :global(.tab-flash) {
    animation: tab-flash 0.8s ease-in-out infinite;
  }
  @keyframes tab-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  :global(.tab-action-required) {
    animation: tab-glow 1.5s ease-in-out infinite;
    border-bottom: 2px solid rgb(249 115 22) !important;
  }
  @keyframes tab-glow {
    0%, 100% { box-shadow: inset 0 0 6px 0 rgba(249, 115, 22, 0.15); }
    50% { box-shadow: inset 0 0 14px 2px rgba(249, 115, 22, 0.3); }
  }
</style>
