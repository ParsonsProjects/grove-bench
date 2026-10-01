<script lang="ts">
  /**
   * The bar between a conversation's tabs and its prompt. Each part is its
   * own component (StatusBar*.svelte), and every popover in it is a
   * StatusBarPopover, so they all open, close and take Escape the same way.
   * This file lays the parts out and owns what they share: the model list
   * and the Alt+M / Alt+T / Alt+E shortcuts.
   */
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { CONTROL_IDS } from '../../shared/types.js';
  import { contextUsage } from '../lib/context-usage.js';
  import SessionControlsPopover from './SessionControlsPopover.svelte';
  import ContextGrove from './ContextGrove.svelte';
  import StatusBarActivity from './StatusBarActivity.svelte';
  import StatusBarLastTurn from './StatusBarLastTurn.svelte';
  import StatusBarCapabilities from './StatusBarCapabilities.svelte';
  import StatusBarBranch from './StatusBarBranch.svelte';
  import StatusBarContext from './StatusBarContext.svelte';
  import StatusBarKeys from './StatusBarKeys.svelte';

  let { sessionId }: { sessionId: string } = $props();

  /** Model list for the agent-settings popover and the context-window fallback. */
  let modelOptions = $state<Array<{ value: string; label: string; contextWindow?: number }>>([]);

  // The model picker lists this conversation's own agent's models; a Codex
  // conversation must not be offered Claude models. Unknown agent type falls
  // back to the default agent, as before.
  let sessionAgentType = $derived(store.sessions.find((s) => s.id === sessionId)?.agentType);
  $effect(() => {
    const agentType = sessionAgentType;
    let cancelled = false;
    const load = () => {
      window.groveBench.getModels(agentType).then((models) => {
        if (!cancelled) modelOptions = models.map((m) => ({ value: m.id, label: m.label, contextWindow: m.contextWindow }));
      }).catch(() => { /* keep the last list */ });
    };
    load();
    // The agent reports its current list when a conversation starts.
    const unsubscribe = window.groveBench.onModelsChanged((adapterId) => {
      if (!agentType || adapterId === agentType) load();
    });
    return () => { cancelled = true; unsubscribe(); };
  });

  let model = $derived(messageStore.getModel(sessionId));
  // SDK-reported window wins; before the first result, fall back to the
  // selected model's known window (e.g. 1M for Opus), then 200k.
  let contextWindow = $derived(
    messageStore.contextWindowBySession[sessionId]
      ?? modelOptions.find((o) => o.value === model)?.contextWindow
      ?? 200_000
  );
  /** For the grove along the top, which grows as the context fills. */
  let usedPercent = $derived(contextUsage(messageStore.getUsage(sessionId), contextWindow).usedPercent);

  function handleKeydown(e: KeyboardEvent) {
    // Every conversation's StatusBar is mounted at once (inactive panes hidden
    // via CSS), so ignore shortcuts unless this is the active conversation.
    // Otherwise Alt+M/T/E cycles the control on every open conversation.
    if (store.activeSessionId !== sessionId) return;
    if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      messageStore.cycleControl(sessionId, CONTROL_IDS.permissionMode);
    }
    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      messageStore.cycleControl(sessionId, CONTROL_IDS.thinking);
    }
    if (e.altKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      messageStore.cycleControl(sessionId, CONTROL_IDS.effort);
    }
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

{#if settingsStore.current.groveCharacters}
  <!-- Stands on the bar's top border, so the border is the grove's ground.
       Only the open conversation's grove plays out its growth. -->
  <ContextGrove seed={sessionId} percent={usedPercent} animate={store.activeSessionId === sessionId} />
{/if}
<!-- The window can be 800px wide with the sidebar open, which leaves this
     bar about 480px. Narrow, the extras drop out so the agent, activity,
     branch and context keep their room: Keys (F1 has the list) and MCP /
     Skills below 672px (MCP stays while a server is down), the project name
     below 768px, and the last turn's cost below 1024px. -->
<div class="@container flex items-center gap-3 px-3 @3xl:gap-4 @3xl:px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  <SessionControlsPopover {sessionId} {modelOptions} />

  <span class="w-px self-stretch bg-border"></span>

  <StatusBarActivity {sessionId} />

  <span class="w-px self-stretch bg-border"></span>

  <StatusBarLastTurn {sessionId} />
  <StatusBarCapabilities {sessionId} />
  <StatusBarBranch {sessionId} />
  <StatusBarContext {sessionId} {contextWindow} />
  <StatusBarKeys />
</div>
