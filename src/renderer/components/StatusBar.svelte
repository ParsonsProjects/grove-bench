<script lang="ts">
  /**
   * The bar between a conversation's tabs and its prompt. Each part is its
   * own component (StatusBar*.svelte), and every popover in it is a
   * StatusBarPopover, so they all open, close and take Escape the same way.
   * This file lays the parts out, in the order, sides and visibility set in
   * Settings (statusBarLayout), and owns what they share: the model list and
   * the Alt+M / Alt+T / Alt+E shortcuts. A hidden part stays mounted, so
   * what it keeps going (the PR poll, the thread's tasks) still runs.
   */
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { CONTROL_IDS } from '../../shared/types.js';
  import type { StatusBarPartId, StatusBarSide } from '../../shared/status-bar-layout.js';
  import { contextUsage } from '../lib/context-usage.js';
  import SessionControlsPopover from './SessionControlsPopover.svelte';
  import ContextGrove from './ContextGrove.svelte';
  import StatusBarActivity from './StatusBarActivity.svelte';
  import StatusBarLastTurn from './StatusBarLastTurn.svelte';
  import StatusBarThreadItems from './StatusBarThreadItems.svelte';
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

  /** Parts drawn with a divider after them, as the bar always had. */
  const DIVIDED: ReadonlySet<StatusBarPartId> = new Set(['agent', 'activity', 'last-turn']);
  /** Parts that always draw something. The others can draw nothing (Last
   *  turn before the first turn, Context before any is used) or drop out on
   *  a narrow bar (Keys, Tasks and Files, MCP and Skills). */
  const ALWAYS_DRAWN: ReadonlySet<StatusBarPartId> = new Set(['agent', 'activity', 'branch']);

  let layout = $derived(settingsStore.current.statusBarLayout);
  /** The divided parts that get their divider: those with a shown part that
   *  always draws somewhere after them on their side, so a divider can't be
   *  left against the spacer or the bar's end. */
  let divided = $derived.by(() => {
    const ids = new Set<StatusBarPartId>();
    const drawnAfter: Record<StatusBarSide, boolean> = { left: false, right: false };
    for (const part of [...layout].reverse()) {
      if (!part.shown) continue;
      if (DIVIDED.has(part.id) && drawnAfter[part.side]) ids.add(part.id);
      if (ALWAYS_DRAWN.has(part.id)) drawnAfter[part.side] = true;
    }
    return ids;
  });
  /** The right side starts at its first shown part. */
  let rightStart = $derived(layout.find((p) => p.shown && p.side === 'right')?.id);

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

{#snippet part(id: StatusBarPartId)}
  {#if id === 'agent'}
    <SessionControlsPopover {sessionId} {modelOptions} />
  {:else if id === 'activity'}
    <StatusBarActivity {sessionId} />
  {:else if id === 'thread-items'}
    <StatusBarThreadItems {sessionId} />
  {:else if id === 'last-turn'}
    <!-- Draws its own divider, which drops out with it on a narrow bar. -->
    <StatusBarLastTurn {sessionId} divider={divided.has(id)} />
  {:else if id === 'capabilities'}
    <StatusBarCapabilities {sessionId} />
  {:else if id === 'branch'}
    <StatusBarBranch {sessionId} />
  {:else if id === 'context'}
    <StatusBarContext {sessionId} {contextWindow} />
  {:else if id === 'keys'}
    <StatusBarKeys />
  {/if}
  {#if id !== 'last-turn' && divided.has(id)}
    <span class="w-px self-stretch bg-border"></span>
  {/if}
{/snippet}

{#if settingsStore.current.groveCharacters}
  <!-- Stands on the bar's top border, so the border is the grove's ground.
       Only the open conversation's grove plays out its growth. -->
  <ContextGrove seed={sessionId} percent={usedPercent} animate={store.activeSessionId === sessionId} />
{/if}
<!-- The window can be 800px wide with the sidebar open, which leaves this
     bar about 480px. Narrow, the extras drop out so the agent, activity,
     branch and context keep their room: Keys (Help has the list), MCP /
     Skills and Tasks / Files below 672px (MCP stays while a server is down,
     Tasks while a task is still to do), the project name below 768px, and
     the last turn's cost below 1024px. Each part sits in a display: contents
     box, so the bar lays out the part itself, and the box is what hides it
     and what moves when the order changes (keyed, so the part keeps its
     state). -->
<div data-status-bar class="@container flex items-center gap-3 px-3 @3xl:gap-4 @3xl:px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  {#each layout as { id, shown } (id)}
    <div data-status-bar-part={id} class={shown ? 'contents' : undefined} hidden={!shown}>
      {#if id === rightStart}
        <!-- Pushes the right side over. The negative margin takes back the
             bar's gap, so the space between the sides is only what is free. -->
        <span class="flex-1 -ml-3 @3xl:-ml-4" aria-hidden="true"></span>
      {/if}
      {@render part(id)}
    </div>
  {/each}
</div>
