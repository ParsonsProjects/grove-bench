<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import ChangesReviewPanel from './ChangesReviewPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let activeTab = $state<'activity' | 'changes'>('activity');

  let fileChanges = $derived(messageStore.getLastTurnFileChanges(sessionId));
  let hasChanges = $derived(fileChanges.length > 0);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let currentMode = $derived(messageStore.getMode(sessionId));

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    return msgs.some((m) => m.kind === 'permission' && !m.resolved);
  });

  // Track mode before switching to changes tab so we can restore it
  let modeBeforeChanges = $state<string | null>(null);

  function switchTab(tab: 'activity' | 'changes') {
    if (tab === activeTab) return;

    if (tab === 'changes') {
      // Save current mode and switch to acceptEdits so future edits auto-execute
      if (currentMode !== 'acceptEdits') {
        modeBeforeChanges = currentMode;
        messageStore.setMode(sessionId, 'acceptEdits');
      }
    } else if (tab === 'activity' && modeBeforeChanges !== null) {
      // Restore previous mode when leaving changes tab
      messageStore.setMode(sessionId, modeBeforeChanges);
      modeBeforeChanges = null;
    }

    activeTab = tab;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Alt+1 / Alt+2 to switch tabs
    if (e.altKey && e.key === '1') { e.preventDefault(); switchTab('activity'); }
    if (e.altKey && e.key === '2') { e.preventDefault(); switchTab('changes'); }
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
          'partial_text', 'activity', 'tool_progress',
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
      Activity
      {#if hasPendingPermission}
        <span class="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
      {:else if isRunning}
        <span class="inline-block w-2 h-2 rounded-full bg-primary animate-spin-dot"></span>
      {/if}
      <span class="text-muted-foreground/60 ml-1">Alt+1</span>
    </button>
    <button
      onclick={() => switchTab('changes')}
      class="px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'changes'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >
      Changes
      {#if hasChanges}
        <span class="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none font-bold">
          {fileChanges.length}
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

<style>
  :global(.animate-spin-dot) {
    animation: spin-dot 1s linear infinite;
  }
  @keyframes spin-dot {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
  }
</style>
