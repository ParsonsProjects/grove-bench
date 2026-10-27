<script lang="ts">
  /**
   * The PR's details in the branch popup (StatusBarBranch): checks, reviews
   * and alerts, the conversation's other PRs, and auto turns. Closing the
   * popup counts as having looked, so the "new" chips and the branch dots'
   * pulse clear (see markAlertsSeen) when this goes.
   */
  import { onDestroy } from 'svelte';
  import { prStore } from '../stores/pr.svelte.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { badgeVariants } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import { prHealth } from '../lib/pr-state.js';
  import type { PrInfo } from '../../shared/types.js';

  // Session state comes from StatusBarBranch, so the "agent is idle" rule
  // here and on its Create PR buttons can't drift apart.
  let {
    sessionId,
    prInfo,
    sessionBranch,
    ghAvailable,
    isRunning,
    canAgentCreatePr,
    preparingPrTurn,
    oncreatepr,
    onclose,
  }: {
    sessionId: string;
    /** The primary PR: what the branch's steps, alerts, and automation follow. */
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
    /** Close the popup, after a turn has been sent. */
    onclose: () => void;
  } = $props();

  /** The session's other PRs (replaced, stacked, or from another branch). */
  let otherPrs = $derived(prStore.getPrs(sessionId).filter((p) => p.number !== prInfo.number));

  // ── PR watching: alerts + auto mode ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let addressingReviews = $state(false);
  let addressReviewsNotice = $state<string | null>(null);
  let fixCiNotice = $state<string | null>(null);
  let prFetchFailed = $derived(prStore.fetchFailedBySession[sessionId] ?? false);

  // Alerts merge into their sections rather than rendering as separate rows
  let ciAlert = $derived(prAlerts.find((a) => a.kind === 'ci_failed'));
  let commentsAlert = $derived(prAlerts.find((a) => a.kind === 'new_comments'));
  let humanAlert = $derived(prAlerts.find((a) => a.kind === 'needs_human'));

  /** Only an open PR is watched (see detectPrEvents), so only an open one
   *  gets the agent actions and automation. */
  let prOpen = $derived(prInfo.state === 'OPEN');
  let c = $derived(prInfo.checks);
  /** Waiting on an approving review: the usual state of an open PR, so it
   *  gets a Reviews row even with no review yet. */
  let reviewRequired = $derived(prOpen && prInfo.reviewDecision === 'REVIEW_REQUIRED');
  /** Every PR here is merged or closed: more work on the branch needs a new one. */
  let hasOpenPr = $derived(prStore.getPrs(sessionId).some((p) => p.state === 'OPEN'));

  // Shown only while the popup is open, so going counts as having looked.
  onDestroy(() => prStore.markAlertsSeen(sessionId));

  function fixCi() {
    fixCiNotice = null;
    if (prStore.fixCiWithAgent(sessionId)) onclose();
    else fixCiNotice = 'The agent is busy — try again when it goes idle';
  }

  async function addressReviews() {
    if (addressingReviews) return;
    addressingReviews = true;
    addressReviewsNotice = null;
    try {
      const result = await prStore.addressReviewsWithAgent(sessionId);
      if (result === 'sent') onclose();
      else if (result === 'empty') addressReviewsNotice = 'No review comments found on the PR';
      else addressReviewsNotice = 'The agent is busy — try again when it goes idle';
    } catch {
      addressReviewsNotice = 'Could not fetch review comments — check gh auth';
    } finally {
      addressingReviews = false;
    }
  }

  /** The "new" chips: amber, as a caution, and a button, since a click
   *  clears them. */
  const newChip = badgeVariants({ tone: 'warning', variant: 'soft', class: 'hover:bg-current/20 transition-colors' });
</script>

<!-- Header -->
<div class="flex items-center justify-between gap-2">
  <span class="font-medium text-foreground truncate" title={prInfo.title}>
    PR #{prInfo.number}{prInfo.title ? ` — ${prInfo.title}` : ''}
  </span>
  <Button
    variant="external"
    size="inline"
    onclick={() => window.groveBench.openExternal(prInfo.url)}
    title="Open on GitHub"
  >
    Open ↗
  </Button>
</div>
<div class="text-muted-foreground mt-0.5 truncate" title={prInfo.headRefName ? `${prInfo.headRefName} → ${prInfo.baseRefName ?? '?'}` : undefined}>
  {prInfo.isDraft ? 'draft' : (prInfo.state ?? 'open').toLowerCase()}{#if prInfo.headRefName}{' · '}{prInfo.headRefName} → {prInfo.baseRefName ?? '?'}{/if}
</div>
{#if prFetchFailed}
  <div class="text-amber-500 mt-0.5" title="The last gh fetch failed — check network and gh auth status">
    may be stale — the last GitHub fetch failed
  </div>
{/if}

<!-- Merged or closed, with no open PR in the conversation: the
     branch popup has no Create PR button, so further work starts one here. -->
{#if !hasOpenPr && sessionBranch && ghAvailable}
  <div class="border-t border-border pt-2 mt-2">
    <div
      class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors"
      title="No open PR here: start a new one for more work on this branch"
    >
      <span class="text-muted-foreground w-14 shrink-0">New PR</span>
      <span class="flex-1"></span>
      <Button
        variant="link"
        size="inline"
        onclick={() => { onclose(); oncreatepr('agent'); }}
        disabled={!canAgentCreatePr || preparingPrTurn}
        class="disabled:no-underline disabled:cursor-not-allowed"
        title={canAgentCreatePr ? 'Send a turn asking the agent to commit, push, and open a new PR' : 'The agent must be idle and running'}
      >
        with agent →
      </Button>
      <Button
        variant="link"
        size="inline"
        onclick={() => { onclose(); oncreatepr('manual'); }}
        disabled={isRunning}
        class="disabled:no-underline disabled:cursor-not-allowed"
        title={isRunning ? 'Create a pull request once the agent finishes its turn' : 'Open the PR dialog: title and description prefilled from the branch\'s commits'}
      >
        manually…
      </Button>
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
            class={newChip}
            title="Failed since you last looked — click to clear"
          >
            new
          </button>
        {/if}
      </span>
      {#if c.failed > 0 && prOpen}
        <Button
          variant="link"
          size="inline"
          onclick={fixCi}
          disabled={!canAgentCreatePr}
          class="disabled:no-underline disabled:cursor-not-allowed"
          title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : 'The agent must be idle and running'}
        >
          fix with agent →
        </Button>
      {/if}
    </div>
    {#if prInfo.failingChecks && prInfo.failingChecks.length > 0}
      <div class="text-muted-foreground pl-16 truncate" title={prInfo.failingChecks.join(', ')}>
        {prInfo.failingChecks.join(', ')}
      </div>
    {/if}
    {#if fixCiNotice}
      <div class="text-amber-500 pl-16 truncate" title={fixCiNotice}>
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
          <span class="text-amber-500 whitespace-nowrap" title="Changes requested">changes</span>
        {:else if reviewRequired}
          <span class="text-muted-foreground whitespace-nowrap" title="Review required: the base branch needs an approving review before this PR can merge">required</span>
        {:else}
          <span class="text-muted-foreground">commented</span>
        {/if}
        {#if commentsAlert}
          {@const ca = commentsAlert}
          <button
            onclick={() => prStore.dismissAlert(sessionId, ca.id)}
            class={newChip}
            title="{ca.count} new comment{ca.count > 1 ? 's' : ''} since you last looked — click to clear"
          >
            {ca.count} new
          </button>
        {/if}
      </span>
      {#if prInfo.state === 'OPEN' && (prInfo.reviewDecision === 'CHANGES_REQUESTED' || commentsAlert)}
        <Button
          variant="link"
          size="inline"
          onclick={addressReviews}
          disabled={!canAgentCreatePr || addressingReviews}
          class="disabled:no-underline disabled:cursor-not-allowed"
          title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : 'The agent must be idle and running'}
        >
          {addressingReviews ? 'fetching…' : 'address with agent →'}
        </Button>
      {/if}
    </div>
    {#if addressReviewsNotice}
      <div class="text-amber-500 pl-16 truncate" title={addressReviewsNotice}>
        {addressReviewsNotice}
      </div>
    {/if}
  {/if}

  {#if humanAlert}
    {@const ha = humanAlert}
    <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors text-amber-500">
      <span class="w-1.5 h-1.5 bg-current shrink-0"></span>
      <span class="flex-1" title={ha.reason}>{ha.reason}</span>
      <Button
        variant="quiet"
        size="icon-2xs"
        onclick={() => prStore.dismissAlert(sessionId, ha.id)}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <XIcon />
      </Button>
    </div>
  {/if}
</div>

<!-- Other PRs tied to this session: a replaced PR on the same branch,
     a stacked PR into another base, or one the agent opened from a
     second branch. Only the primary is watched; "watch" swaps it. -->
{#if otherPrs.length > 0}
  <div class="border-t border-border pt-2 mt-2 space-y-0.5">
    <SectionLabel class="mb-1">Other PRs in this thread</SectionLabel>
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
          <span class="text-muted-foreground">{other.isDraft ? 'draft' : (other.state ?? 'open').toLowerCase()}</span>
          {#if other.title}<span class="text-muted-foreground"> — {other.title}</span>{/if}
        </span>
        <Button
          variant="link"
          size="inline"
          onclick={() => prStore.setPrimary(sessionId, other.number)}
          title="Follow this PR instead: the branch's steps, alerts, and auto turns switch to it"
        >
          watch
        </Button>
        <Button
          variant="external"
          size="inline"
          onclick={() => window.groveBench.openExternal(other.url)}
          title="Open on GitHub"
        >
          ↗
        </Button>
      </div>
    {/each}
    <p class="text-micro text-muted-foreground mt-1.5">
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
  <p class="text-micro text-muted-foreground mt-1.5">
    Auto turns run only while the thread is idle; git push / gh may need to be allowed.
  </p>
</div>
{/if}
