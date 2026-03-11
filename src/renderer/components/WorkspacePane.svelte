<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import PromptEditor from './PromptEditor.svelte';

  let { sessionId }: { sessionId: string } = $props();

  onMount(async () => {
    messageStore.subscribe(sessionId);

    if (!messageStore.getIsReady(sessionId)) {
      try {
        const history = await window.groveBench.getEventHistory(sessionId);
        messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] history replay: ${history.length} events` } as any);
        for (const event of history) {
          messageStore.ingestEvent(sessionId, event);
        }
        if (history.length > 0) {
          const last = history[history.length - 1];
          if (last.type === 'result' || last.type === 'process_exit') {
            messageStore.isRunning[sessionId] = false;
          }
        }
      } catch (e: any) {
        messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] history replay failed: ${e?.message || e}` } as any);
      }
    } else {
      messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] already ready, skipping history replay` } as any);
    }
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
