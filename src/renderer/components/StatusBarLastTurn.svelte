<script lang="ts">
  /**
   * The activity popup's usage rows: how long the last turn took and, on
   * an API sign-in, what it cost; what the thread has used so far (its
   * tokens) and, with a cost, what it and today have cost (main's figures,
   * the ones the spend limits count). The thread's and today's figures are
   * asked for while `active` (the popup is open) and again when a turn ends.
   */
  import { untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { formatUsd } from '../../shared/limits.js';
  import { formatTokens } from '../lib/context-usage.js';
  import type { ThreadUsage } from '../../shared/types.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let {
    sessionId,
    active,
    onclose,
  }: {
    sessionId: string;
    /** The popup is open: ask for the thread's and today's figures. */
    active: boolean;
    /** Called before Settings opens at Limits & alerts. */
    onclose?: () => void;
  } = $props();

  let lastResult = $derived(messageStore.lastResult(sessionId));

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
    if (lastResult?.totalCostUsd !== undefined && onPlan === null) void untrack(() => usageStore.refresh(sessionId).catch(() => {}));
  });
  let lastTurnCost = $derived.by(() => {
    const usd = lastResult?.totalCostUsd;
    return usd === undefined || onPlan !== false ? '' : formatUsd(usd);
  });
  /** Claude Code's figure is list price; other agents pass on what their
   *  provider reported (OpenCode through OpenRouter, for example). */
  let reportsPlanUsage = $derived.by(() => {
    const agentType = store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId;
    return agentsStore.get(agentType)?.capabilities.usage !== false;
  });
  /** How long the last turn took, as "18.4s". */
  let took = $derived(lastResult?.durationMs !== undefined ? `${(lastResult.durationMs / 1000).toFixed(1)}s` : '');
  let lastTurnTitle = $derived.by(() => {
    const usd = lastResult?.totalCostUsd;
    const tookText = took ? `took ${took}` : '';
    const basis = reportsPlanUsage ? 'at list price (an estimate)' : 'as the agent reported it';
    if (lastTurnCost && usd !== undefined) return `Last turn: $${usd.toFixed(4)} ${basis}${tookText ? `, ${tookText}` : ''}`;
    return `Last turn ${tookText}${onPlan ? '. Your plan covers it: see Usage in Agent settings' : ''}`;
  });

  /** A figure in the popup: null while it's being asked for. */
  type Asked<T> = T | 'unknown' | null;
  /** The thread's usage and today's spend, asked for when the popup opens
   *  and again when a turn ends while it is open. Each settles on its own. */
  let thread = $state<Asked<ThreadUsage>>(null);
  let todayUsd = $state<Asked<number>>(null);
  /** Only the latest ask's answers are shown. */
  let asking = 0;
  $effect(() => {
    if (!active) {
      // Answers still on their way are for an open that has ended.
      asking++;
      thread = null;
      todayUsd = null;
      return;
    }
    void lastResult?.id;
    const withCost = !!lastTurnCost;
    const ask = ++asking;
    const settle = <T,>(set: (value: Asked<T>) => void) => [
      (value: T) => { if (ask === asking) set(value); },
      () => { if (ask === asking) set('unknown'); },
    ] as const;
    untrack(() => {
      void window.groveBench.getThreadUsage(sessionId).then(...settle<ThreadUsage>((v) => { thread = v; }));
      if (withCost) void window.groveBench.getDailySpend().then(...settle<number>((v) => { todayUsd = v; }));
    });
  });
  const pending = (value: Asked<unknown>) => (value === null ? '…' : 'unknown');
  let threadUsd = $derived(typeof thread === 'object' && thread ? formatUsd(thread.spendUsd) : pending(thread));
  let today = $derived(typeof todayUsd === 'number' ? formatUsd(todayUsd) : pending(todayUsd));
  /** Tokens as "in / out", or why there are none to show. */
  let tokens = $derived.by(() => {
    if (typeof thread !== 'object' || !thread) return { in: pending(thread), out: pending(thread) };
    const { input, output } = thread.tokens;
    if (input === 0 && output === 0) return null;
    return { in: formatTokens(input), out: formatTokens(output) };
  });
</script>

{#if lastTurnCost || lastResult?.durationMs !== undefined}
  <dl class="space-y-1.5 text-muted-foreground">
    <div class="flex justify-between gap-3" title={lastTurnTitle} data-testid="last-turn">
      <dt>Last turn</dt>
      <dd class="text-foreground">{[took, lastTurnCost].filter(Boolean).join(' · ')}</dd>
    </div>
    {#if lastTurnCost}
      <div class="flex justify-between gap-3"><dt>This thread</dt><dd class="text-foreground">{threadUsd}</dd></div>
      <div class="flex justify-between gap-3"><dt>Today, all threads</dt><dd class="text-foreground">{today}</dd></div>
    {/if}
    {#if tokens}
      <div class="flex justify-between gap-3"><dt>Tokens in, this thread</dt><dd class="text-foreground">{tokens.in}</dd></div>
      <div class="flex justify-between gap-3"><dt>Tokens out, this thread</dt><dd class="text-foreground">{tokens.out}</dd></div>
    {:else}
      <div class="flex justify-between gap-3"><dt>Tokens, this thread</dt><dd>none reported</dd></div>
    {/if}
  </dl>
  <p class="mt-2 text-caption text-muted-foreground">
    {#if lastTurnCost}
      Estimates. This thread's are {reportsPlanUsage ? 'at list price' : 'as its agent reported them'}. Today's add up every thread since midnight as each agent estimates it, threads on a plan included.
    {/if}
    {reportsPlanUsage ? 'Tokens in count what the model read, prompt cache included.' : 'Tokens as the agent reported them.'}
  </p>
  <Button variant="link" size="inline" class="mt-2" onclick={() => { onclose?.(); settingsStore.openAt('limits'); }}>
    Limits & alerts
  </Button>
{/if}
