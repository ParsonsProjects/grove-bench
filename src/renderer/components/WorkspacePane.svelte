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
  let terminalRunning = $derived(terminalStore.getIsRunning(sessionId));

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    return msgs.some((m) => m.kind === 'permission' && !m.resolved);
  });

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

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);

    // Always replay history on mount — clear any stale state first to avoid
    // duplicates. This is critical after refresh/restart where prior state is
    // lost but isReady might have been set by a leaked event.
    try {
      // Clear existing messages so replay starts fresh
      messageStore.clearSession(sessionId);

      // Subscribe to live events BEFORE replaying history so no events are
      // missed for sessions that are still being set up (worktree creation,
      // npm install). History replay below will fill in any prior events, and
      // ingestEvent is idempotent for duplicate status messages.
      messageStore.subscribe(sessionId);

      // Suppress git status refreshes during replay to avoid N IPC calls
      gitStatusStore.suppressRefresh = true;
      const history = await window.groveBench.getEventHistory(sessionId);
      // Skip transient events during replay — partial_text is superseded by
      // assistant_text, and activity/tool_progress are ephemeral status updates.
      const skipDuringReplay = new Set([
        'partial_text', 'activity', 'tool_progress', 'usage',
        // Dev server URLs from history point to servers that are no longer
        // running after a restart — skip to avoid showing dead localhost links.
        'devserver_detected',
      ]);

      // Build a set of toolUseIds that have a tool_result in history so we
      // can auto-resolve permission_request events during replay instead of
      // skipping them entirely (which loses the "allowed"/"denied" indicator).
      const resolvedToolUseIds = new Set<string>();
      const toolResultErrors = new Set<string>();
      for (const ev of history) {
        if (ev.type === 'tool_result') {
          resolvedToolUseIds.add(ev.toolUseId);
          if (ev.isError) toolResultErrors.add(ev.toolUseId);
        }
      }

      for (const event of history) {
        if (skipDuringReplay.has(event.type)) continue;

        // For permission_request, replay it pre-resolved if a matching
        // tool_result exists, so the UI shows "allowed"/"denied" history.
        // If no tool_result exists yet (still pending), replay as unresolved.
        if (event.type === 'permission_request') {
          messageStore.ingestEvent(sessionId, event);
          if (resolvedToolUseIds.has(event.toolUseId)) {
            // Auto-resolve: find the permission we just pushed and mark it
            const msgs = messageStore.getMessages(sessionId);
            const idx = msgs.findIndex(
              (m) => (m.kind === 'permission' || m.kind === 'question') && 'requestId' in m && m.requestId === event.requestId,
            );
            if (idx >= 0) {
              const msg = msgs[idx];
              if (msg.kind === 'permission' && !msg.resolved) {
                const wasError = toolResultErrors.has(event.toolUseId);
                const updated = { ...msg, resolved: true as const, decision: (wasError ? 'deny' : 'allow') as 'allow' | 'deny' };
                const current = [...msgs];
                current[idx] = updated;
                messageStore.messagesBySession[sessionId] = current;
              } else if (msg.kind === 'question' && !msg.resolved) {
                const updated = { ...msg, resolved: true as const };
                const current = [...msgs];
                current[idx] = updated;
                messageStore.messagesBySession[sessionId] = current;
              }
            }
          }
          continue;
        }

        messageStore.ingestEvent(sessionId, event);
      }
      if (history.length > 0) {
        const last = history[history.length - 1];
        if (last.type === 'result' || last.type === 'process_exit') {
          messageStore.isRunning[sessionId] = false;
        }
      }
      // After replay, resolve any tool_calls still marked pending
      messageStore.resolveStaleToolCalls(sessionId);

      // If the session is already running but system_init was missed during
      // replay (e.g. agent just connected), ensure the input unlocks.
      // SESSION_STATUS 'running' only fires after system_init on the main side.
      const session = store.sessions.find((s) => s.id === sessionId);
      if (session?.status === 'running' && !messageStore.getIsReady(sessionId)) {
        messageStore.isReady[sessionId] = true;
        messageStore.isRunning[sessionId] = false;
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
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M4 17h8v2H4v-2Zm-2-4h2v2H2v-2h2v-2H2V9h2V7H2V5h2V3h16v2h2v16H4v-2H2v-6Zm4-2h2v2H6v-2Zm2-2H6V7h2v2Zm2 2H8v-2h2v2Z"/></svg>
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
