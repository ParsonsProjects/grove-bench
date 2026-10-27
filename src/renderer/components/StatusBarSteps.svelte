<script lang="ts">
  /**
   * The branch popup's steps to merged (StatusBarBranch), each with what it
   * needs on its own row: the PR's title and link, a "new" chip for activity
   * since you last looked, the failing checks, and the agent's fix where a
   * step has one. Under them, a note the watcher left for you, the Auto row
   * and the thread's other PRs. Closing the popup counts as having looked,
   * so the "new" chips and the branch dots' pulse clear (see markAlertsSeen)
   * when this goes.
   */
  import { onDestroy } from 'svelte';
  import { prStore } from '../stores/pr.svelte.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { badgeVariants } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import { prHealth } from '../lib/pr-state.js';
  import type { ShipStep, ShipStepState, ShipTrack } from '../lib/ship-track.js';
  import type { PrInfo } from '../../shared/types.js';
  import ShipDot from './ShipDot.svelte';

  let {
    sessionId,
    track,
    prInfo,
    canAgentCreatePr,
    onclose,
  }: {
    sessionId: string;
    track: ShipTrack;
    /** The primary PR: what the steps, alerts and auto turns follow. */
    prInfo: PrInfo | null | undefined;
    /** Agent turns need a live, idle session (StatusBarBranch decides, so
     *  its Create PR buttons and these can't drift apart). */
    canAgentCreatePr: boolean;
    /** Close the popup, after a turn has been sent. */
    onclose: () => void;
  } = $props();

  /** The session's other PRs (replaced, stacked, or from another branch). */
  let otherPrs = $derived(prInfo ? prStore.getPrs(sessionId).filter((p) => p.number !== prInfo.number) : []);

  // ── PR watching: alerts + auto mode ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let addressingReviews = $state(false);
  let addressReviewsNotice = $state<string | null>(null);
  let fixCiNotice = $state<string | null>(null);
  let prFetchFailed = $derived(prStore.fetchFailedBySession[sessionId] ?? false);

  // Each alert shows on its step's row; one that needs you gets its own.
  let ciAlert = $derived(prAlerts.find((a) => a.kind === 'ci_failed'));
  let commentsAlert = $derived(prAlerts.find((a) => a.kind === 'new_comments'));
  let humanAlert = $derived(prAlerts.find((a) => a.kind === 'needs_human'));

  /** Only an open PR is watched (see detectPrEvents), so only an open one
   *  gets the agent actions and automation. */
  let prOpen = $derived(prInfo?.state === 'OPEN');
  let failingChecks = $derived(prInfo?.failingChecks ?? []);
  let canFixCi = $derived(prOpen && (prInfo?.checks?.failed ?? 0) > 0);
  let canAddressReviews = $derived(prOpen && (prInfo?.reviewDecision === 'CHANGES_REQUESTED' || !!commentsAlert));

  // Shown only while the popup is open, so going counts as having looked.
  onDestroy(() => prStore.markAlertsSeen(sessionId));

  function fixCi() {
    fixCiNotice = null;
    if (prStore.fixCiWithAgent(sessionId)) onclose();
    else fixCiNotice = 'The agent is busy: try again when it goes idle';
  }

  async function addressReviews() {
    if (addressingReviews) return;
    addressingReviews = true;
    addressReviewsNotice = null;
    try {
      const result = await prStore.addressReviewsWithAgent(sessionId);
      if (result === 'sent') onclose();
      else if (result === 'empty') addressReviewsNotice = 'No review comments found on the PR';
      else addressReviewsNotice = 'The agent is busy: try again when it goes idle';
    } catch {
      addressReviewsNotice = 'Could not fetch review comments: check gh auth';
    } finally {
      addressingReviews = false;
    }
  }

  const DETAIL: Record<ShipStepState, string> = {
    done: 'text-foreground',
    next: 'text-foreground',
    running: 'text-foreground',
    failed: 'text-red-400',
    attention: 'text-amber-500',
    merged: 'text-purple-400',
    closed: 'text-muted-foreground',
    todo: 'text-muted-foreground',
  };

  /** What a step's words leave out, for its tooltip. */
  function hint(step: ShipStep): string | undefined {
    if (step.id === 'pr' && prInfo?.headRefName) return `${prInfo.headRefName} → ${prInfo.baseRefName ?? '?'}`;
    if (step.id === 'checks' && failingChecks.length > 0) return `Failing: ${failingChecks.join(', ')}`;
    if (step.id === 'review' && prInfo?.reviewDecision === 'REVIEW_REQUIRED') {
      return 'The base branch needs an approving review before this PR can merge';
    }
    return undefined;
  }

  /** The "new" chips: amber, as a caution, and a button, since a click
   *  clears them. */
  const newChip = badgeVariants({ tone: 'warning', variant: 'soft', class: 'shrink-0 hover:bg-current/20 transition-colors' });
</script>

{#if prFetchFailed}
  <p class="text-amber-500 mb-2" title="The last gh fetch failed: check network and gh auth status">
    May be out of date: the last GitHub fetch failed
  </p>
{/if}

<ol class="space-y-1" aria-label="Steps to merged">
  {#each track.steps as step (step.id)}
    <li class="flex items-start gap-2">
      <!-- As tall as a line of text, so the dot sits on the first one. -->
      <span class="flex h-4 shrink-0 items-center"><ShipDot state={step.state} /></span>
      <span class="w-14 shrink-0 text-muted-foreground">{step.label}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <!-- Cut short only when the row runs out of room; the tooltip has it whole. -->
          <span class="min-w-0 truncate {DETAIL[step.state]}" title={hint(step) ?? step.detail}>{step.detail}</span>

          {#if step.id === 'pr' && prInfo}
            {#if prInfo.title}
              <!-- Takes what room is left, so the number and state stay whole. -->
              <span class="flex-1 min-w-0 truncate text-muted-foreground" title={prInfo.title}>{prInfo.title}</span>
            {/if}
            <Button
              variant="external"
              size="inline"
              class="ml-auto shrink-0"
              onclick={() => window.groveBench.openExternal(prInfo.url)}
              title="Open on GitHub"
            >
              Open ↗
            </Button>
          {:else if step.id === 'checks'}
            {#if ciAlert}
              {@const ci = ciAlert}
              <button onclick={() => prStore.dismissAlert(sessionId, ci.id)} class={newChip} title="Failed since you last looked. Click to clear">
                new
              </button>
            {/if}
            {#if canFixCi}
              <Button
                variant="link"
                size="inline"
                onclick={fixCi}
                disabled={!canAgentCreatePr}
                class="ml-auto shrink-0 disabled:no-underline disabled:cursor-not-allowed"
                title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : 'The agent must be idle and running'}
              >
                fix with agent →
              </Button>
            {/if}
          {:else if step.id === 'review'}
            {#if commentsAlert}
              {@const ca = commentsAlert}
              <button
                onclick={() => prStore.dismissAlert(sessionId, ca.id)}
                class={newChip}
                title="{ca.count} new comment{ca.count > 1 ? 's' : ''} since you last looked. Click to clear"
              >
                {ca.count} new
              </button>
            {/if}
            {#if canAddressReviews}
              <Button
                variant="link"
                size="inline"
                onclick={addressReviews}
                disabled={!canAgentCreatePr || addressingReviews}
                class="ml-auto shrink-0 disabled:no-underline disabled:cursor-not-allowed"
                title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : 'The agent must be idle and running'}
              >
                {addressingReviews ? 'fetching…' : 'address with agent →'}
              </Button>
            {/if}
          {/if}
        </div>

        {#if step.id === 'checks'}
          {#if failingChecks.length > 0}
            <div class="text-muted-foreground truncate" title={failingChecks.join(', ')}>{failingChecks.join(', ')}</div>
          {/if}
          {#if fixCiNotice}
            <div class="text-amber-500 truncate" title={fixCiNotice}>{fixCiNotice}</div>
          {/if}
        {:else if step.id === 'review' && addressReviewsNotice}
          <div class="text-amber-500 truncate" title={addressReviewsNotice}>{addressReviewsNotice}</div>
        {/if}
      </div>
    </li>
  {/each}
</ol>

{#if humanAlert}
  {@const ha = humanAlert}
  <div class="flex items-center gap-2 mt-2 text-amber-500">
    <span class="size-1.5 bg-current shrink-0"></span>
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

<!-- Automation: only an open PR is watched, so only it offers any. -->
{#if prOpen}
  <div class="border-t border-border pt-2 mt-3">
    <!-- Lined up with the steps: a dot's room, then the label. -->
    <div class="flex items-center gap-2">
      <span class="size-1.5 shrink-0"></span>
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

<!-- Other PRs tied to this session: a replaced PR on the same branch,
     a stacked PR into another base, or one the agent opened from a
     second branch. Only the primary is watched; "watch" swaps it. -->
{#if otherPrs.length > 0}
  <div class="border-t border-border pt-2 mt-3 space-y-0.5">
    <SectionLabel class="mb-1">Other PRs in this thread</SectionLabel>
    {#each otherPrs as other (other.number)}
      {@const otherHealth = prHealth(other)}
      <div class="flex items-center gap-2">
        <span class="size-1.5 {otherHealth.bgClass} shrink-0"></span>
        <span
          class="flex-1 min-w-0 truncate"
          title="{other.title ? `${other.title}: ` : ''}{other.headRefName ?? '?'} → {other.baseRefName ?? '?'} ({otherHealth.label})"
        >
          <span class="text-foreground">#{other.number}</span>
          <span class="text-muted-foreground">{other.isDraft ? 'draft' : (other.state ?? 'open').toLowerCase()}</span>
          {#if other.title}<span class="text-muted-foreground">: {other.title}</span>{/if}
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
