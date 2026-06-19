<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import { messageStore } from './stores/messages.svelte.js';
  import { settingsStore } from './stores/settings.svelte.js';
  import { setAnalyticsEnabled, trackEvent } from './lib/analytics.js';
  import { restoreWorktrees } from './lib/restore-worktrees.js';
  import { startIdleManager } from './lib/idle-manager.js';
  import { deriveSessionName } from './lib/session-name.js';
  import Sidebar from './components/Sidebar.svelte';
  import WorkspacePane from './components/WorkspacePane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';
  import SessionFinder from './components/SessionFinder.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import AnalyticsConsent from './components/AnalyticsConsent.svelte';
  import BookmarksDrawer from './components/BookmarksDrawer.svelte';
  import { bookmarkStore } from './stores/bookmarks.svelte.js';

  let showAnalyticsConsent = $state(false);

  let restored = $state(false);

  // A session is "live" (has a connection) when it isn't stopped — these are
  // the ones persisted so they reopen/resume on restart.
  let liveSessions = $derived(store.sessions.filter((s) => s.status === 'running' || s.status === 'starting' || s.status === 'installing' || s.status === 'error'));

  async function restoreApp() {
    await restoreWorktrees();

    // Resume all previously-open tabs, not just the active one
    const persistedOpenTabs = await window.groveBench.getOpenTabs();
    const openSet = new Set(persistedOpenTabs);

    // Stop sessions that the main process still considers running but
    // that were closed before reload (stopQuery keeps them alive).
    for (const session of store.sessions) {
      if (session.status === 'running' && !openSet.has(session.id)) {
        store.updateStatus(session.id, 'stopped');
        window.groveBench.stopSession(session.id).catch(() => {});
      }
    }

    for (const tabId of persistedOpenTabs) {
      const session = store.sessions.find((s) => s.id === tabId);
      if (session && session.status === 'stopped') {
        window.groveBench.resumeSession(tabId, session.repoPath).then((result) => {
          store.updateStatus(result.id, 'running');
        }).catch((e: any) => {
          store.setError(e.message || String(e));
          failedResumeIds.add(tabId);
        });
      }
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

  // Track per-session running state to detect turn completion. Flash state
  // itself lives in the store so the sidebar can read it.
  let prevRunningState = $state<Record<string, boolean>>({});

  // Detect when a session transitions from running → idle (a turn completed)
  $effect(() => {
    for (const session of store.sessions) {
      const running = messageStore.getIsRunning(session.id);
      const wasRunning = prevRunningState[session.id] ?? false;
      if (wasRunning && !running) {
        if (store.activeSessionId !== session.id) {
          store.markNeedsAttention(session.id);
        }
        maybeAutoNameSession(session);
      }
      prevRunningState[session.id] = running;
    }
  });

  /** After a turn completes, give an unnamed session a heuristic name derived
   *  from its first (non-command) user message. The displayName guard makes
   *  this fire once and never overwrites a manually-set name. */
  function maybeAutoNameSession(session: { id: string; displayName?: string | null }) {
    if (session.displayName) return;
    const firstUser = messageStore
      .getMessages(session.id)
      .find((m) => m.kind === 'user' && !m.text.startsWith('/'));
    if (!firstUser || firstUser.kind !== 'user') return;
    const name = deriveSessionName(firstUser.text);
    if (!name) return;
    window.groveBench
      .renameSession(session.id, name)
      .then(() => store.updateDisplayName(session.id, name))
      .catch(() => { /* non-fatal — naming is best-effort */ });
  }

  // Clear flash when switching to a session
  $effect(() => {
    const activeId = store.activeSessionId;
    if (activeId) {
      store.clearNeedsAttention(activeId);
    }
  });

  // Persist active tab across restarts — skip until restore completes
  // to avoid overwriting the persisted value with null on hot reload
  $effect(() => {
    if (restored) {
      window.groveBench.setActiveTab(store.activeSessionId);
    }
  });

  // Persist live session IDs so they reopen/resume on restart
  $effect(() => {
    if (restored) {
      window.groveBench.setOpenTabs(liveSessions.map((s) => s.id));
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

  function reopenLastClosedTab() {
    const id = store.popRecentlyClosed();
    if (!id) return;
    const session = store.sessions.find((s) => s.id === id);
    if (!session || session.status !== 'stopped') return;
    // Setting it as active triggers the existing $effect that auto-resumes stopped sessions
    store.activeSessionId = id;
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      showSessionFinder = !showSessionFinder;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      reopenLastClosedTab();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'b') {
      e.preventDefault();
      bookmarkStore.toggleDrawer();
    }
  }

  // Sessions with a resume in flight (Set, not a single id, so resumes of
  // different sessions don't clobber each other's tracking).
  let resumingIds = new Set<string>();
  // Sessions whose last auto-resume failed. A failure here used to block the
  // tab's auto-resume permanently; instead we clear it when the user navigates
  // (back) to the tab, so a transient failure retries on explicit re-selection.
  let failedResumeIds = new Set<string>();
  let prevActiveResumeId: string | null = null;

  /** Resume a stopped session, deduped against in-flight and recently-failed
   *  resumes. Used by the active-session auto-resume effect and by the
   *  wake-from-sleep handler (which resumes every tab that died during sleep). */
  function resumeStoppedSession(session: { id: string; repoPath: string; status: string } | null | undefined) {
    if (!session || session.status !== 'stopped') return;
    if (resumingIds.has(session.id) || failedResumeIds.has(session.id)) return;
    const sessionId = session.id;
    resumingIds.add(sessionId);
    window.groveBench.resumeSession(sessionId, session.repoPath).then((result) => {
      store.updateStatus(result.id, 'running');
      // Don't subscribe here — WorkspacePane handles history replay + subscription
      // on mount. Subscribing here would race with mount and cause isReady to be
      // set before history replay, resulting in an empty chat.
      failedResumeIds.delete(sessionId);
    }).catch((e: any) => {
      store.setError(e.message || String(e));
      failedResumeIds.add(sessionId);
    }).finally(() => {
      resumingIds.delete(sessionId);
    });
  }

  $effect(() => {
    const session = store.activeSession;
    const activeId = session?.id ?? null;

    // Treat navigating to a (different) session as explicit retry intent:
    // drop any prior failure so the resume below can be attempted again.
    if (activeId !== prevActiveResumeId) {
      prevActiveResumeId = activeId;
      if (activeId) failedResumeIds.delete(activeId);
    }

    resumeStoppedSession(session);
  });

  onMount(() => {
    settingsStore.load();
    bookmarkStore.load();
    store.loadRepos().then(() => restoreApp()).catch((e) => {
      console.error('Failed to load repos:', e);
    });
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

    // After system resume (laptop wake), bring back every tab that was running
    // before sleep. The main process reports which sessions died during suspend
    // (their SDK query usually doesn't survive); resume them all so they stay in
    // the Active list instead of silently dropping to Inactive. (The focused
    // session is also covered by the auto-resume effect; resumingIds dedupes.)
    const unsubPower = window.groveBench.onPowerResume((resumeIds) => {
      for (const id of resumeIds) {
        const session = store.sessions.find((s) => s.id === id);
        if (!session || session.status === 'running') continue;
        // healthCheckAll already emits SESSION_STATUS 'stopped'; guard in case
        // that event hasn't been applied yet so resumeStoppedSession can proceed.
        if (session.status !== 'stopped') {
          store.updateStatus(id, 'stopped');
          messageStore.markSessionStopped(id);
        }
        resumeStoppedSession(store.sessions.find((s) => s.id === id));
      }
    });

    // Auto-close idle sessions to reclaim their PTY + agent processes.
    const stopIdleManager = startIdleManager();

    return () => {
      unsub();
      unsubPower();
      stopIdleManager();
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

</script>

<PrerequisiteCheck />

<div class="flex flex-col h-screen bg-background text-foreground font-mono">
<TitleBar />
<div class="flex flex-1 min-h-0">
  <Sidebar />

  <main class="flex-1 flex flex-col min-w-0 min-h-0">
    {#if store.sessions.length === 0}
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
    {:else if !store.activeSessionId}
      <div class="pixel-bg flex-1 flex items-center justify-center text-muted-foreground relative overflow-hidden">
        {#each Array(20) as _, i}
          <span
            class="blue-pixel absolute"
            style="width:4px;height:4px;top:{Math.round((8+(((i*37+13)*7)%84))/100*800/6)*6}px;left:{Math.round((5+(((i*53+7)*11)%90))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
          ></span>
        {/each}
        <div class="text-center relative z-10">
          <p class="text-sm">Select a session from the sidebar.</p>
        </div>
      </div>
    {:else}
      <!-- Active session — keep all live panes mounted, show only the active one -->
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
    {/if}
  </main>
</div>
</div>

{#if showSessionFinder}
  <SessionFinder onclose={() => showSessionFinder = false} />
{/if}

<ErrorToast />

<BookmarksDrawer />

<AnalyticsConsent visible={showAnalyticsConsent} />
