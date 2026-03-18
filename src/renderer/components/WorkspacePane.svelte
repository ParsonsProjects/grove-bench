<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import ChangesReviewPanel from './ChangesReviewPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let activeTab = $derived(messageStore.getActiveTab(sessionId));

  let gitStatus = $derived(gitStatusStore.getStatus(sessionId));
  let hasChanges = $derived(gitStatus.entries.length > 0);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    return msgs.some((m) => m.kind === 'permission' && !m.resolved);
  });

  function switchTab(tab: 'activity' | 'changes' | 'plan') {
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
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);

    // Always replay history on mount — clear any stale state first to avoid
    // duplicates. This is critical after refresh/restart where prior state is
    // lost but isReady might have been set by a leaked event.
    try {
      // Clear existing messages so replay starts fresh
      messageStore.clearSession(sessionId);

      // Suppress git status refreshes during replay to avoid N IPC calls
      gitStatusStore.suppressRefresh = true;
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
    } finally {
      gitStatusStore.suppressRefresh = false;
    }

    // Single git status refresh after replay
    gitStatusStore.refresh(sessionId);

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
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
    <OutputPanel {sessionId} />
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'changes' ? '' : 'hidden'}">
    <ChangesReviewPanel {sessionId} />
  </div>

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
