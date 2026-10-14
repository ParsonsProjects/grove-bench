<script lang="ts">
  /**
   * The last turn: its cost (API sign-ins only) over how long it took. Only
   * on a wide bar; the separator after it goes with it. With a cost, a click
   * opens what the thread and today have cost so far, from main's spend
   * figures (the ones the spend limits count).
   */
  import { untrack } from 'svelte';
  import { messageStore, type ChatResultMessage } from '../stores/messages.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { formatUsd } from '../../shared/limits.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

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
    return usd === undefined || onPlan !== false ? '' : formatUsd(usd);
  });
  /** Claude Code's figure is list price; other agents pass on what their
   *  provider reported (OpenCode through OpenRouter, for example). */
  let reportsPlanUsage = $derived.by(() => {
    const agentType = store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId;
    return agentsStore.get(agentType)?.capabilities.usage !== false;
  });
  let lastTurnTitle = $derived.by(() => {
    const usd = lastResult?.totalCostUsd;
    const took = lastResult?.durationMs !== undefined ? `took ${(lastResult.durationMs / 1000).toFixed(1)}s` : '';
    const basis = reportsPlanUsage ? 'at list price (an estimate)' : 'as the agent reported it';
    if (lastTurnCost && usd !== undefined) return `Last turn: $${usd.toFixed(4)} ${basis}${took ? `, ${took}` : ''}`;
    return `Last turn ${took}${onPlan ? '. Your plan covers it: see Usage in Agent settings' : ''}`;
  });

  let spendOpen = $state(false);
  /** The thread's and today's spend, asked for when the popover opens and
   *  again when a turn ends while it is open. */
  let spend = $state<{ thread: number; today: number } | null>(null);
  let spendFailed = $state(false);
  $effect(() => {
    if (!spendOpen) return;
    void lastResult?.id;
    untrack(() => {
      Promise.all([window.groveBench.getThreadSpend(sessionId), window.groveBench.getDailySpend()]).then(
        ([thread, today]) => { spend = { thread, today }; spendFailed = false; },
        () => { spendFailed = true; },
      );
    });
  });
</script>

{#snippet summary()}
  {#if lastTurnCost}
    <span>{lastTurnCost}</span>
  {/if}
  <span class="text-caption text-muted-foreground">
    last turn{#if lastResult?.durationMs !== undefined}&nbsp;{(lastResult.durationMs / 1000).toFixed(1)}s{/if}
  </span>
{/snippet}

{#if lastTurnCost}
  <StatusBarPopover bind:open={spendOpen} class="hidden @5xl:block" id="status-bar-spend-{sessionId}" label="Spend" panelClass="w-64">
    {#snippet trigger()}
      <button
        onclick={() => spendOpen = !spendOpen}
        class="flex flex-col gap-px leading-snug whitespace-nowrap text-left hover:text-foreground transition-colors"
        title={lastTurnTitle}
        aria-expanded={spendOpen}
        aria-controls="status-bar-spend-{sessionId}"
        data-testid="last-turn"
      >
        {@render summary()}
      </button>
    {/snippet}

    <div class="font-medium text-foreground mb-2">Spend</div>
    <dl class="space-y-1.5 text-muted-foreground">
      <div class="flex justify-between gap-3"><dt>Last turn</dt><dd class="text-foreground">{lastTurnCost}</dd></div>
      <div class="flex justify-between gap-3"><dt>This thread</dt><dd class="text-foreground">{spend ? formatUsd(spend.thread) : spendFailed ? 'unknown' : '…'}</dd></div>
      <div class="flex justify-between gap-3"><dt>Today, all threads</dt><dd class="text-foreground">{spend ? formatUsd(spend.today) : spendFailed ? 'unknown' : '…'}</dd></div>
    </dl>
    <p class="mt-2 text-caption text-muted-foreground">
      Estimates, {reportsPlanUsage ? 'at list price' : 'as the agent reported them'}. Today adds up every thread since midnight.
    </p>
    <Button variant="link" size="inline" class="mt-2" onclick={() => { spendOpen = false; settingsStore.openAt('limits'); }}>
      Spend limits
    </Button>
  </StatusBarPopover>
{:else if lastResult?.durationMs !== undefined}
  <div class="hidden @5xl:flex flex-col gap-px leading-snug whitespace-nowrap" title={lastTurnTitle} data-testid="last-turn">
    {@render summary()}
  </div>
{/if}

{#if lastTurnCost || lastResult?.durationMs !== undefined}
  <span class="hidden @5xl:block w-px self-stretch bg-border"></span>
{/if}
