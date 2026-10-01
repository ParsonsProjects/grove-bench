<script lang="ts">
  /**
   * The last turn: its cost (API sign-ins only) over how long it took. Only
   * on a wide bar; the separator after it goes with it.
   */
  import { untrack } from 'svelte';
  import { messageStore, type ChatResultMessage } from '../stores/messages.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store } from '../stores/sessions.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let lastResult = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === 'result') return msgs[i] as ChatResultMessage;
    }
    return null;
  });

  /** On a plan (Pro, Max, ...) turns count toward the plan's limits, and the
   *  SDK's dollar figure is list price that isn't billed, so it is left out:
   *  https://code.claude.com/docs/en/costs. The answer comes from plan usage
   *  (reported means a plan), so null while that isn't known yet. An agent
   *  that can't report usage can't say, so its cost shows. */
  let onPlan = $derived.by((): boolean | null => {
    const usage = usageStore.get(usageStore.providerFor(sessionId));
    if (usage) return usage.available;
    if (!agentsStore.loaded) return null;
    const agentType = store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId;
    return agentsStore.get(agentType)?.capabilities.usage === true ? null : false;
  });
  // A restored conversation can have a cost before anything asked for plan
  // usage: ask (the store throttles and shares it across conversations).
  $effect(() => {
    if (lastResult?.totalCostUsd !== undefined && onPlan === null) untrack(() => usageStore.refresh(sessionId).catch(() => {}));
  });
  let lastTurnCost = $derived.by(() => {
    const usd = lastResult?.totalCostUsd;
    if (usd === undefined || onPlan !== false) return '';
    if (usd === 0) return '$0.00';
    return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
  });
  let lastTurnTitle = $derived.by(() => {
    const usd = lastResult?.totalCostUsd;
    const took = lastResult?.durationMs !== undefined ? `took ${(lastResult.durationMs / 1000).toFixed(1)}s` : '';
    if (lastTurnCost && usd !== undefined) return `Last turn: $${usd.toFixed(4)} at list price (an estimate)${took ? `, ${took}` : ''}`;
    return `Last turn ${took}${onPlan ? '. Your plan covers it: see Usage in Agent settings' : ''}`;
  });
</script>

{#if lastTurnCost || lastResult?.durationMs !== undefined}
  <div class="hidden @5xl:flex flex-col gap-px leading-snug whitespace-nowrap" title={lastTurnTitle} data-testid="last-turn">
    {#if lastTurnCost}
      <span>{lastTurnCost}</span>
    {/if}
    <span class="text-[11px] text-muted-foreground/70">
      last turn{#if lastResult?.durationMs !== undefined}&nbsp;{(lastResult.durationMs / 1000).toFixed(1)}s{/if}
    </span>
  </div>

  <span class="hidden @5xl:block w-px self-stretch bg-border"></span>
{/if}
