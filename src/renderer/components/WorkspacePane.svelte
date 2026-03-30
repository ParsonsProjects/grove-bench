<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import ChangesReviewPanel from './ChangesReviewPanel.svelte';
  import TerminalPanel from './TerminalPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';
  import { terminalStore } from '../stores/terminal.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let activeTab = $derived(messageStore.getActiveTab(sessionId));

  let gitStatus = $derived(gitStatusStore.getStatus(sessionId));
  let hasChanges = $derived(gitStatus.entries.length > 0);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let terminalRunning = $derived(terminalStore.isAlive(sessionId));

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived(messageStore.hasPendingPermission(sessionId));

  function switchTab(tab: 'activity' | 'changes' | 'plan' | 'terminal') {
    if (tab === activeTab) return;
    messageStore.setActiveTab(sessionId, tab);
    if (tab === 'changes') {
      gitStatusStore.refresh(sessionId);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Alt+1 / Alt+2 to switch tabs
    if (e.altKey && e.key === '1') { e.preventDefault(); switchTab('activity'); }
    if (e.altKey && e.key === '2') { e.preventDefault(); switchTab('changes'); }
    if (e.altKey && e.key === '3') { e.preventDefault(); switchTab('terminal'); }
  }

  // Reactively unlock the input whenever the session reaches 'running' (or 'error')
  // status. This covers race conditions where SESSION_STATUS arrives before or after
  // mount, or where clearSession resets isReady after it was already set.
  // IMPORTANT: read `ready` outside the condition so Svelte always tracks isReady
  // as a dependency — otherwise short-circuit evaluation when status is 'starting'
  // causes isReady changes to be missed.
  $effect(() => {
    const session = store.sessions.find((s) => s.id === sessionId);
    const ready = messageStore.getIsReady(sessionId);
    if (session && (session.status === 'running' || session.status === 'error') && !ready) {
      messageStore.setIsReady(sessionId, true);
      messageStore.setIsRunning(sessionId, false);
    }
  });

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);

    // Always replay history on mount — clear any stale state first to avoid
    // duplicates. This is critical after refresh/restart where prior state is
    // lost but isReady might have been set by a leaked event.
    try {
      // Clear existing messages so replay starts fresh.
      // clearSession does NOT reset isReady — that's handled below based on
      // actual session state to avoid racing with the SESSION_STATUS handler.
      messageStore.clearSession(sessionId);

      // Reset isReady ONLY for sessions that haven't reached 'running' yet.
      // For sessions already 'running' or 'error', isReady should stay true
      // (or be set true below) so the input doesn't flicker disabled.
      const sessionBefore = store.sessions.find((s) => s.id === sessionId);
      if (!sessionBefore || (sessionBefore.status !== 'running' && sessionBefore.status !== 'error')) {
        messageStore.setIsReady(sessionId, false);
      }

      // Subscribe to live events BEFORE replaying history so no events are
      // missed for sessions that are still being set up (worktree creation,
      // npm install). History replay below will fill in any prior events, and
      // ingestEvent is idempotent for duplicate status messages.
      messageStore.subscribe(sessionId);

      // Suppress git status refreshes during replay to avoid N IPC calls
      gitStatusStore.suppressRefresh = true;

      // Load only the most recent events to avoid stalling on large histories.
      // Older events are loaded on demand when the user scrolls up.
      const INITIAL_PAGE_SIZE = 200;
      const skipDuringReplay = new Set([
        'partial_text', 'activity', 'tool_progress', 'usage',
        // Dev server URLs from history point to servers that are no longer
        // running after a restart — skip to avoid showing dead localhost links.
        'devserver_detected',
      ]);

      const page = await window.groveBench.getEventHistoryPage(sessionId, INITIAL_PAGE_SIZE);
      messageStore.setPagination(sessionId, page.totalCount, page.startIndex);

      // Batch-replay events. replayEvents accumulates messages in a plain
      // array and flushes to the reactive store in one assignment at the end,
      // avoiding O(n²) array copies and hundreds of intermediate re-renders.
      messageStore.replayEvents(sessionId, page.events, skipDuringReplay);
      if (page.events.length > 0) {
        const last = page.events[page.events.length - 1];
        if (last.type === 'result' || last.type === 'process_exit') {
          messageStore.setIsRunning(sessionId, false);
        }
      }
      // After replay, resolve any permissions/tool_calls still unresolved
      // (denied permissions have no tool_result, stopped sessions cleared theirs)
      messageStore.resolveStaleToolCalls(sessionId);
      messageStore.resolveStaleBackgroundTasks(sessionId);
      messageStore.resolveReplayedPermissions(sessionId);

      // If the session is already running but system_init was missed during
      // replay (e.g. agent just connected, or SESSION_STATUS arrived during
      // the await above), ensure the input unlocks.
      const session = store.sessions.find((s) => s.id === sessionId);
      if (session && (session.status === 'running' || session.status === 'error') && !messageStore.getIsReady(sessionId)) {
        messageStore.setIsReady(sessionId, true);
        messageStore.setIsRunning(sessionId, false);
      }
    } catch (e: any) {
      messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] history replay failed: ${e?.message || e}` } as any);
    } finally {
      gitStatusStore.suppressRefresh = false;
    }

    // Single git status refresh after replay
    gitStatusStore.refresh(sessionId);
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
        <span class="inline-block w-2 h-2 bg-amber-500 animate-pulse"></span>
      {:else if isRunning}
        <span class="inline-block w-2 h-2 bg-primary animate-pulse"></span>
      {/if}
      <span class="text-muted-foreground/60 ml-1">Alt+1</span>
    </button>
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
          {gitStatus.entries.length}
        </span>
      {/if}
      <span class="text-muted-foreground/60 ml-1">Alt+2</span>
    </button>
    <button
      onclick={() => switchTab('terminal')}
      class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'terminal'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><polyline points="4,6 10,12 4,18"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
      Terminal
      {#if terminalRunning}
        <span class="inline-block w-2 h-2 bg-green-500 animate-pulse"></span>
      {/if}
      <span class="text-muted-foreground/60 ml-1">Alt+3</span>
    </button>
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
    <OutputPanel {sessionId} />
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'changes' ? '' : 'hidden'}">
    <ChangesReviewPanel {sessionId} />
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'terminal' ? '' : 'hidden'}">
    <TerminalPanel {sessionId} />
  </div>

  <StatusBar {sessionId} />
  {#if activeTab === 'activity'}
    <PromptEditor {sessionId} />
  {:else if activeTab === 'terminal'}
    <!-- Terminal has its own input -->
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
