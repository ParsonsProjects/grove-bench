<script lang="ts">
  /**
   * Cost, tokens and agent time across every thread, removed ones included,
   * by model and by thread, over a range of days (main's usage ledger). In
   * the Usage dialog and the Usage section of Settings.
   */
  import { untrack } from 'svelte';
  import type { UsageSummary } from '../../shared/types.js';
  import { formatUsd } from '../../shared/limits.js';
  import { formatTokens } from '../lib/context-usage.js';
  import { USAGE_RANGES, formatAgentTime, rangeSince, type UsageRange } from '../lib/usage-report.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  /** What Claude Code's dollar figures are, and that a plan doesn't bill them. */
  const COSTS_DOC = 'https://code.claude.com/docs/en/costs';
  /** How often to ask again while older history is being added up. */
  const BACKFILL_POLL_MS = 1500;

  let range = $state<UsageRange>('week');
  let summary = $state<UsageSummary | null>(null);
  let failed = $state(false);
  /** Only the latest ask's answer is shown. */
  let asking = 0;

  async function load(): Promise<void> {
    const ask = ++asking;
    failed = false;
    try {
      const next = await window.groveBench.getUsageSummary(rangeSince(range));
      if (ask === asking) summary = next;
    } catch (e) {
      console.warn('[usage] summary failed:', e);
      if (ask === asking) failed = true;
    }
  }

  $effect(() => {
    void range;
    void agentsStore.load();
    untrack(() => void load());
  });

  // Ask again while main is still adding up threads' older history.
  $effect(() => {
    if (!summary?.backfilling) return;
    const timer = setTimeout(() => void load(), BACKFILL_POLL_MS);
    return () => clearTimeout(timer);
  });

  const agentName = (id: string) => (id ? agentsStore.get(id)?.displayName ?? id : 'Unknown agent');
  const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const lastRan = (ms: number | undefined) => {
    if (ms === undefined) return '';
    const d = new Date(ms);
    return Date.now() - ms < 24 * 3600 * 1000
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  let empty = $derived(summary !== null && summary.total.turns === 0);
  let rangeLabel = $derived(USAGE_RANGES.find((r) => r.id === range)?.label.toLowerCase() ?? '');
</script>

<div class="flex flex-col gap-4 text-xs" data-testid="usage-report">
  <div class="flex items-center justify-between gap-3">
    <Segmented.Root
      value={range}
      onValueChange={(v) => { if (v) range = v as UsageRange; }}
      aria-label="Range"
    >
      {#each USAGE_RANGES as r (r.id)}
        <Segmented.Item value={r.id}>{r.label}</Segmented.Item>
      {/each}
    </Segmented.Root>
    {#if summary?.backfilling}
      <span class="flex items-center gap-1.5 text-muted-foreground" data-testid="usage-backfilling">
        <Pulse />Adding up older threads…
      </span>
    {/if}
  </div>

  {#if failed}
    <Notice tone="danger">
      {#snippet actions()}
        <Button size="2xs" variant="link" onclick={() => void load()}>Try again</Button>
      {/snippet}
      <p>Couldn't read usage.</p>
    </Notice>
  {:else if !summary}
    <div class="flex items-center gap-2 py-6 text-muted-foreground"><Pulse />Loading usage…</div>
  {:else if empty}
    <p class="py-6 text-muted-foreground" data-testid="usage-empty">
      {summary.backfilling ? 'Nothing added up yet.' : range === 'all' ? 'No turns recorded yet.' : `No turns in the last ${rangeLabel}.`}
    </p>
  {:else}
    <dl class="grid grid-cols-5 gap-2" data-testid="usage-totals">
      <div class="border border-border bg-card px-3 py-2">
        <dt class="text-muted-foreground">Cost (estimate)</dt>
        <dd class="text-base font-semibold text-foreground tabular-nums">{formatUsd(summary.total.usd)}</dd>
      </div>
      <div class="border border-border bg-card px-3 py-2">
        <dt class="text-muted-foreground">Tokens in</dt>
        <dd class="text-base font-semibold text-foreground tabular-nums">{formatTokens(summary.total.input)}</dd>
      </div>
      <div class="border border-border bg-card px-3 py-2">
        <dt class="text-muted-foreground">Tokens out</dt>
        <dd class="text-base font-semibold text-foreground tabular-nums">{formatTokens(summary.total.output)}</dd>
      </div>
      <div class="border border-border bg-card px-3 py-2">
        <dt class="text-muted-foreground">Agent time</dt>
        <dd class="text-base font-semibold text-foreground tabular-nums">{formatAgentTime(summary.total.ms)}</dd>
      </div>
      <div class="border border-border bg-card px-3 py-2">
        <dt class="text-muted-foreground">Turns</dt>
        <dd class="text-base font-semibold text-foreground tabular-nums">{summary.total.turns}</dd>
      </div>
    </dl>

    <section>
      <SectionLabel class="mb-1">By model</SectionLabel>
      <table class="w-full tabular-nums" data-testid="usage-by-model">
        <thead class="text-muted-foreground">
          <tr class="border-b border-border">
            <th class="py-1 pr-2 text-left font-normal">Model</th>
            <th class="py-1 px-2 text-right font-normal">Cost</th>
            <th class="py-1 px-2 text-right font-normal">In</th>
            <th class="py-1 px-2 text-right font-normal">Out</th>
            <th class="py-1 px-2 text-right font-normal">Time</th>
            <th class="py-1 pl-2 text-right font-normal">Turns</th>
          </tr>
        </thead>
        <tbody>
          {#each summary.byModel as m (`${m.agent}\u0000${m.model}`)}
            <tr class="border-b border-border/60">
              <td class="py-1 pr-2">
                <span class="text-foreground {m.model ? 'font-mono' : 'text-muted-foreground'}">{m.model || 'Model not recorded'}</span>
                <span class="ml-1 text-muted-foreground">{agentName(m.agent)}</span>
              </td>
              <td class="py-1 px-2 text-right text-foreground">{formatUsd(m.usd)}</td>
              <td class="py-1 px-2 text-right">{formatTokens(m.input)}</td>
              <td class="py-1 px-2 text-right">{formatTokens(m.output)}</td>
              <td class="py-1 px-2 text-right">{m.turns > 0 ? formatAgentTime(m.ms) : ''}</td>
              <td class="py-1 pl-2 text-right">{m.turns > 0 ? m.turns : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section>
      <SectionLabel class="mb-1">By thread</SectionLabel>
      <div class="max-h-72 overflow-y-auto">
        <table class="w-full tabular-nums" data-testid="usage-by-thread">
          <thead class="sticky top-0 bg-background text-muted-foreground">
            <tr class="border-b border-border">
              <th class="py-1 pr-2 text-left font-normal">Thread</th>
              <th class="py-1 px-2 text-right font-normal">Cost</th>
              <th class="py-1 px-2 text-right font-normal">In</th>
              <th class="py-1 px-2 text-right font-normal">Out</th>
              <th class="py-1 px-2 text-right font-normal">Time</th>
              <th class="py-1 pl-2 text-right font-normal">Last ran</th>
            </tr>
          </thead>
          <tbody>
            {#each summary.byThread as t (t.thread)}
              <tr class="border-b border-border/60" data-testid="usage-thread-row">
                <td class="py-1 pr-2 max-w-0 w-1/2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="truncate text-foreground" title={t.title || t.thread}>{t.title || t.thread}</span>
                    {#if t.removed}<Badge tone="muted" class="shrink-0">removed</Badge>{/if}
                  </div>
                  <div class="truncate text-muted-foreground">
                    {[t.repoPath ? store.repoDisplayName(t.repoPath) : '', agentName(t.agent)].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td class="py-1 px-2 text-right text-foreground">{formatUsd(t.usd)}</td>
                <td class="py-1 px-2 text-right">{formatTokens(t.input)}</td>
                <td class="py-1 px-2 text-right">{formatTokens(t.output)}</td>
                <td class="py-1 px-2 text-right">{formatAgentTime(t.ms)}</td>
                <td class="py-1 pl-2 text-right text-muted-foreground">{lastRan(t.lastAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if summary}
    <div class="flex flex-col gap-1 text-caption text-muted-foreground" data-testid="usage-notes">
      <p>
        Costs are estimates, not a bill. On a Claude subscription (Pro, Max and others) your plan covers them, and turns count toward its limits instead
        (<Button variant="external" size="inline" onclick={() => window.groveBench.openExternal(COSTS_DOC)}>Claude Code costs</Button>).
        Other agents' costs are as they reported them; one that reports none shows $0.00.
      </p>
      <p>
        Tokens in count what the model read, prompt cache included. Agent time adds up how long each turn took, so threads running side by side can add up to more than the clock. A turn's time goes to the model that did most of it.
      </p>
      {#if summary.recordingSince !== null}
        <p>Dates and models recorded since {day(summary.recordingSince)}. Older turns come from threads' history, dated by their prompt, with no model.</p>
      {/if}
      {#if range === 'all' && summary.undated.turns > 0}
        <p data-testid="usage-undated">{summary.undated.turns} older {summary.undated.turns === 1 ? 'turn has' : 'turns have'} no date, so {summary.undated.turns === 1 ? 'it shows' : 'they show'} only in All time.</p>
      {/if}
    </div>
  {/if}
</div>
