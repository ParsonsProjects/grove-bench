<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';

  let { sessionId }: { sessionId: string } = $props();

  onMount(async () => {
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
    messageStore.unsubscribe(sessionId);
  });
</script>

<div class="flex flex-col h-full bg-background">
  <OutputPanel {sessionId} />
  <StatusBar {sessionId} />
  <PromptEditor {sessionId} />
</div>
