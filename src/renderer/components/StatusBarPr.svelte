<script lang="ts">
  /**
   * The PR pill and its popover: checks, reviews and alerts, the
   * conversation's other PRs, and auto turns. The pill's dot shows the PR's
   * worst condition and pulses on unseen activity.
   */
  import { untrack } from 'svelte';
  import { prStore } from '../stores/pr.svelte.js';
  import type { PrAlert } from '../stores/pr.svelte.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { prHealth } from '../lib/pr-state.js';
  import type { PrInfo } from '../../shared/types.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  // Session state comes from StatusBarBranch, so the "agent is idle" rule
  // here and on its Create PR link can't drift apart.
  let {
    sessionId,
    prInfo,
    sessionBranch,
    ghAvailable,
    isRunning,
    canAgentCreatePr,
    preparingPrTurn,
    oncreatepr,
  }: {
    sessionId: string;
    /** The primary PR: what the pill, alerts, and automation follow. */
    prInfo: PrInfo;
    sessionBranch: string;
    ghAvailable: boolean;
    isRunning: boolean;
    /** Agent turns need a live, idle session. */
    canAgentCreatePr: boolean;
    /** A "create PR" turn is being prepared, so it can't be sent twice. */
    preparingPrTurn: boolean;
    /** Start a new PR, by a turn for the agent or by the dialog. */
    oncreatepr: (how: 'agent' | 'manual') => void;
  } = $props();

  /** The session's other PRs (replaced, stacked, or from another branch). */
  let otherPrs = $derived(prStore.getPrs(sessionId).filter((p) => p.number !== prInfo.number));

  // ── PR watching: alerts + auto mode (all shown in one popover) ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let prPopoverOpen = $state(false);
  let addressingReviews = $state(false);
  let addressReviewsNotice = $state<string | null>(null);
  let fixCiNotice = $state<string | null>(null);
  let prFetchFailed = $derived(prStore.fetchFailedBySession[sessionId] ?? false);

  // Alerts merge into their popover sections rather than rendering as separate rows
  let ciAlert = $derived(prAlerts.find((a) => a.kind === 'ci_failed') as Extract<PrAlert, { kind: 'ci_failed' }> | undefined);
  let commentsAlert = $derived(prAlerts.find((a) => a.kind === 'new_comments') as Extract<PrAlert, { kind: 'new_comments' }> | undefined);
  let humanAlert = $derived(prAlerts.find((a) => a.kind === 'needs_human') as Extract<PrAlert, { kind: 'needs_human' }> | undefined);

  /** Worst condition on the PR, for the collapsed badge's dot and tooltip.
   *  Shared with the sidebar's branch icon so the two always agree. */
  let prHealthInfo = $derived(prHealth(prInfo));
  /** Only an open PR is watched (see detectPrEvents), so only an open one
   *  gets the agent actions and automation. */
  let prOpen = $derived(prInfo.state === 'OPEN');
  /** Waiting on an approving review: the usual state of an open PR, so it
   *  gets a Reviews row even with no review yet. */
  let reviewRequired = $derived(prOpen && prInfo.reviewDecision === 'REVIEW_REQUIRED');
  /** Every PR here is merged or closed: more work on the branch needs a new one. */
  let hasOpenPr = $derived(prStore.getPrs(sessionId).some((p) => p.state === 'OPEN'));
  /** The pill's tooltip carries the health in words: the dot is colour only. */
  let prPillTitle = $derived.by(() => {
    const parts = [`PR #${prInfo.number}: ${prHealthInfo.label}`];
    if (prAlerts.length > 0) parts.push('new activity');
    if (prFetchFailed) parts.push('may be out of date, the last GitHub fetch failed');
    // Saved across restarts, so say when it is on rather than leave it hidden.
    const auto = [prAuto.fixCi && 'fix CI', prAuto.addressReviews && 'address reviews'].filter(Boolean);
    if (prOpen && auto.length > 0) parts.push(`auto: ${auto.join(' + ')}`);
    if (otherPrs.length > 0) parts.push(`+${otherPrs.length} more in this thread`);
    return `${prInfo.title ? `${prInfo.title}\n` : ''}${parts.join(', ')}. Click for checks, reviews, and automation`;
  });

  // Closing the popover counts as having looked: its "new" chips, and the
  // pill's pulse, clear (see markAlertsSeen).
  let prPopoverWasOpen = false;
  $effect(() => {
    const open = prPopoverOpen;
    if (prPopoverWasOpen && !open) untrack(() => prStore.markAlertsSeen(sessionId));
    prPopoverWasOpen = open;
  });

  function fixCi() {
    fixCiNotice = null;
    if (prStore.fixCiWithAgent(sessionId)) prPopoverOpen = false;
    else fixCiNotice = 'The agent is busy — try again when it goes idle';
  }

  async function addressReviews() {
    if (addressingReviews) return;
    addressingReviews = true;
    addressReviewsNotice = null;
    try {
      const result = await prStore.addressReviewsWithAgent(sessionId);
      if (result === 'sent') prPopoverOpen = false;
      else if (result === 'empty') addressReviewsNotice = 'No review comments found on the PR';
      else addressReviewsNotice = 'The agent is busy — try again when it goes idle';
    } catch {
      addressReviewsNotice = 'Could not fetch review comments — check gh auth';
    } finally {
      addressingReviews = false;
    }
  }

  let prColor = $derived(
    prInfo.state === 'MERGED' ? 'text-purple-400 hover:text-purple-300'
    : prInfo.state === 'CLOSED' ? 'text-red-400 hover:text-red-300'
    : prInfo.isDraft ? 'text-muted-foreground hover:text-foreground'
    : 'text-blue-400 hover:text-blue-300',
  );
</script>

<StatusBarPopover bind:open={prPopoverOpen} anchored={false} animate panelClass="bg-popover border border-border shadow-xl p-3 text-xs w-96">
  {#snippet trigger()}
    <button
      onclick={() => { prPopoverOpen = !prPopoverOpen; if (prPopoverOpen) { addressReviewsNotice = null; fixCiNotice = null; } }}
      class="flex items-center gap-1.5 {prColor} transition-colors"
      title={prPillTitle}
      aria-expanded={prPopoverOpen}
    >
      <!-- One dot: color = worst condition, pulse = unseen activity,
           faded = the last GitHub fetch failed, so it may be old -->
      <span class="w-1.5 h-1.5 {prHealthInfo.bgClass} {prAlerts.length > 0 ? 'animate-pulse' : ''} {prFetchFailed ? 'opacity-50' : ''}"></span>
      PR #{prInfo.number}
      {#if otherPrs.length > 0}
        <span class="text-muted-foreground/60">+{otherPrs.length}</span>
      {/if}
    </button>
  {/snippet}

  {@const c = prInfo.checks}
  <!-- Header -->
  <div class="flex items-center justify-between gap-2">
    <span class="font-medium text-foreground truncate" title={prInfo.title}>
      PR #{prInfo.number}{prInfo.title ? ` — ${prInfo.title}` : ''}
    </span>
    <button
      onclick={() => window.groveBench.openExternal(prInfo.url)}
      class="text-blue-400 hover:text-blue-300 hover:underline shrink-0"
      title="Open on GitHub"
    >
      Open ↗
    </button>
  </div>
  <div class="text-muted-foreground/70 mt-0.5 truncate" title={prInfo.headRefName ? `${prInfo.headRefName} → ${prInfo.baseRefName ?? '?'}` : undefined}>
    {prInfo.isDraft ? 'draft' : (prInfo.state ?? 'open').toLowerCase()}{#if prInfo.headRefName}{' · '}{prInfo.headRefName} → {prInfo.baseRefName ?? '?'}{/if}
  </div>
  {#if prFetchFailed}
    <div class="text-orange-400/80 mt-0.5" title="The last gh fetch failed — check network and gh auth status">
      may be stale — the last GitHub fetch failed
    </div>
  {/if}

  <!-- Merged or closed, with no open PR in the conversation: the bar
       has no "Create PR" link, so further work starts one here. -->
  {#if !hasOpenPr && sessionBranch && ghAvailable}
    <div class="border-t border-border pt-2 mt-2">
      <div
        class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors"
        title="No open PR here: start a new one for more work on this branch"
      >
        <span class="text-muted-foreground w-14 shrink-0">New PR</span>
        <span class="flex-1"></span>
        <button
          onclick={() => { prPopoverOpen = false; oncreatepr('agent'); }}
          disabled={!canAgentCreatePr || preparingPrTurn}
          class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          title={canAgentCreatePr ? 'Send a turn asking the agent to commit, push, and open a new PR' : 'The agent must be idle and running'}
        >
          with agent →
        </button>
        <button
          onclick={() => { prPopoverOpen = false; oncreatepr('manual'); }}
          disabled={isRunning}
          class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          title={isRunning ? 'Create a pull request once the agent finishes its turn' : 'Open the PR dialog: title and description prefilled from the branch\'s commits'}
        >
          manually…
        </button>
      </div>
    </div>
  {/if}

  <!-- Status: checks + reviews, alerts merged in as "new" pills -->
  <div class="border-t border-border pt-2 mt-2 space-y-1.5">
    {#if c}
      <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
        <span class="text-muted-foreground w-14 shrink-0">Checks</span>
        <span class="flex items-center gap-2 flex-1 min-w-0">
          {#if c.passed > 0}<span class="text-green-400">✓ {c.passed}</span>{/if}
          {#if c.failed > 0}<span class="text-red-400">✗ {c.failed}</span>{/if}
          {#if c.pending > 0}<span class="text-yellow-400">● {c.pending}</span>{/if}
          {#if ciAlert}
            {@const ci = ciAlert}
            <button
              onclick={() => prStore.dismissAlert(sessionId, ci.id)}
              class="px-1 text-[10px] leading-4 whitespace-nowrap bg-yellow-400/15 text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/25 transition-colors"
              title="Failed since you last looked — click to clear"
            >
              new
            </button>
          {/if}
        </span>
        {#if c.failed > 0 && prOpen}
          <button
            onclick={fixCi}
            disabled={!canAgentCreatePr}
            class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
            title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : 'The agent must be idle and running'}
          >
            fix with agent →
          </button>
        {/if}
      </div>
      {#if prInfo.failingChecks && prInfo.failingChecks.length > 0}
        <div class="text-muted-foreground/60 pl-16 truncate" title={prInfo.failingChecks.join(', ')}>
          {prInfo.failingChecks.join(', ')}
        </div>
      {/if}
      {#if fixCiNotice}
        <div class="text-orange-400/80 pl-16 truncate" title={fixCiNotice}>
          {fixCiNotice}
        </div>
      {/if}
    {/if}

    {#if prInfo.reviewDecision === 'APPROVED' || prInfo.reviewDecision === 'CHANGES_REQUESTED' || reviewRequired || commentsAlert}
      <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
        <span class="text-muted-foreground w-14 shrink-0">Reviews</span>
        <span class="flex items-center gap-2 flex-1 min-w-0">
          {#if prInfo.reviewDecision === 'APPROVED'}
            <span class="text-green-400 whitespace-nowrap">approved</span>
          {:else if prInfo.reviewDecision === 'CHANGES_REQUESTED'}
            <span class="text-orange-400 whitespace-nowrap" title="Changes requested">changes</span>
          {:else if reviewRequired}
            <span class="text-muted-foreground/70 whitespace-nowrap" title="Review required: the base branch needs an approving review before this PR can merge">required</span>
          {:else}
            <span class="text-muted-foreground/70">commented</span>
          {/if}
          {#if commentsAlert}
            {@const ca = commentsAlert}
            <button
              onclick={() => prStore.dismissAlert(sessionId, ca.id)}
              class="px-1 text-[10px] leading-4 whitespace-nowrap bg-yellow-400/15 text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/25 transition-colors"
              title="{ca.count} new comment{ca.count > 1 ? 's' : ''} since you last looked — click to clear"
            >
              {ca.count} new
            </button>
          {/if}
        </span>
        {#if prInfo.state === 'OPEN' && (prInfo.reviewDecision === 'CHANGES_REQUESTED' || commentsAlert)}
          <button
            onclick={addressReviews}
            disabled={!canAgentCreatePr || addressingReviews}
            class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
            title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : 'The agent must be idle and running'}
          >
            {addressingReviews ? 'fetching…' : 'address with agent →'}
          </button>
        {/if}
      </div>
      {#if addressReviewsNotice}
        <div class="text-orange-400/80 pl-16 truncate" title={addressReviewsNotice}>
          {addressReviewsNotice}
        </div>
      {/if}
    {/if}

    {#if humanAlert}
      {@const ha = humanAlert}
      <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors text-orange-400">
        <span class="w-1.5 h-1.5 bg-current shrink-0"></span>
        <span class="flex-1" title={ha.reason}>{ha.reason}</span>
        <button
          onclick={() => prStore.dismissAlert(sessionId, ha.id)}
          class="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
          title="Dismiss"
        >
          &times;
        </button>
      </div>
    {/if}
  </div>

  <!-- Other PRs tied to this session: a replaced PR on the same branch,
       a stacked PR into another base, or one the agent opened from a
       second branch. Only the primary is watched; "watch" swaps it. -->
  {#if otherPrs.length > 0}
    <div class="border-t border-border pt-2 mt-2 space-y-0.5">
      <div class="text-muted-foreground px-1.5 -mx-1.5 mb-1">Other PRs in this thread</div>
      {#each otherPrs as other (other.number)}
        {@const otherHealth = prHealth(other)}
        <!-- Same colours as the pill, so a PR reads the same in both places. -->
        <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
          <span class="w-1.5 h-1.5 {otherHealth.bgClass} shrink-0"></span>
          <span
            class="flex-1 min-w-0 truncate"
            title="{other.title ? `${other.title} — ` : ''}{other.headRefName ?? '?'} → {other.baseRefName ?? '?'} ({otherHealth.label})"
          >
            <span class="text-foreground">#{other.number}</span>
            <span class="text-muted-foreground/70">{other.isDraft ? 'draft' : (other.state ?? 'open').toLowerCase()}</span>
            {#if other.title}<span class="text-muted-foreground"> — {other.title}</span>{/if}
          </span>
          <button
            onclick={() => prStore.setPrimary(sessionId, other.number)}
            class="text-blue-400 hover:text-blue-300 hover:underline shrink-0"
            title="Follow this PR instead: the pill, alerts, and auto turns switch to it"
          >
            watch
          </button>
          <button
            onclick={() => window.groveBench.openExternal(other.url)}
            class="text-blue-400 hover:text-blue-300 hover:underline shrink-0"
            title="Open on GitHub"
          >
            ↗
          </button>
        </div>
      {/each}
      <p class="text-[10px] text-muted-foreground/60 mt-1.5">
        Alerts and auto turns follow one PR at a time.
      </p>
    </div>
  {/if}

  <!-- Automation: only an open PR is watched, so only it offers any -->
  {#if prOpen}
  <div class="border-t border-border pt-2 mt-2">
    <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
      <span class="text-muted-foreground w-14 shrink-0">Auto</span>
      <label
        class="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
        title="When CI fails, send a fix turn automatically. After 2 tries without CI going green, it asks for you"
      >
        <Checkbox
          class="size-3.5"
          checked={prAuto.fixCi}
          onCheckedChange={(v) => prStore.setAuto(sessionId, { fixCi: v === true })}
        />
        fix CI
      </label>
      <label
        class="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
        title="When repository collaborators leave new review feedback, send a turn to address it automatically"
      >
        <Checkbox
          class="size-3.5"
          checked={prAuto.addressReviews}
          onCheckedChange={(v) => prStore.setAuto(sessionId, { addressReviews: v === true })}
        />
        address reviews
      </label>
    </div>
    <p class="text-[10px] text-muted-foreground/60 mt-1.5">
      Auto turns run only while the thread is idle; git push / gh may need to be allowed.
    </p>
  </div>
  {/if}
</StatusBarPopover>
