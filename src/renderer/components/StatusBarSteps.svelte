<script lang="ts">
  /**
   * The branch popup's body (StatusBarBranch): first the Next notice, the
   * one thing to do now with the popup's one main action (lib/ship-track.ts
   * `next`); then a row per step (the branch's sync, checks, review,
   * merge) with what stands behind it: failed jobs with their logs and a
   * rerun, running checks, reviewers, GitHub's merge verdict, and each
   * step's automation. A row offers its own action only when it isn't the
   * next one, in grey, so nothing is offered twice. Then the thread's other
   * PRs, folded. Closing the popup counts as having looked, so the "new"
   * chips and the branch dots' pulse clear (see markAlertsSeen).
   */
  import { onDestroy } from 'svelte';
  import { prStore } from '../stores/pr.svelte.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { badgeVariants } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { prHealth } from '../lib/pr-state.js';
  import { plural, type ShipAction, type ShipStepId, type ShipStepState, type ShipTrack } from '../lib/ship-track.js';
  import type { FailingJob, FailingRun, GitSyncStatus, PrInfo, PrReviewer } from '../../shared/types.js';
  import { errorMessage } from '../../shared/error-message.js';
  import ShipDot from './ShipDot.svelte';

  let {
    sessionId,
    track,
    prInfo,
    sync,
    canAgentCreatePr,
    pushing,
    retrying,
    showCreatePr,
    preparingPrTurn,
    isRunning,
    onpush,
    onretrypush,
    oncreatepr,
    onclose,
  }: {
    sessionId: string;
    track: ShipTrack;
    /** The primary PR: what the steps, alerts and auto turns follow. */
    prInfo: PrInfo | null | undefined;
    sync: GitSyncStatus;
    /** Agent turns need a live, idle session (StatusBarBranch decides, so
     *  the Create PR button and these can't drift apart). */
    canAgentCreatePr: boolean;
    pushing: boolean;
    retrying: boolean;
    /** A PR can be made here: offered on the PR row when it isn't next. */
    showCreatePr: boolean;
    preparingPrTurn: boolean;
    isRunning: boolean;
    onpush: () => void;
    onretrypush: () => void;
    oncreatepr: (how: 'agent' | 'manual') => void;
    /** Close the popup, after a turn has been sent or a log opened. */
    onclose: () => void;
  } = $props();

  let next = $derived(track.next);
  const stepState = (id: ShipStepId): ShipStepState => track.steps.find((s) => s.id === id)?.state ?? 'todo';
  let pushFailed = $derived(stepState('push') === 'failed');

  /** The session's other PRs (replaced, stacked, or from another branch). */
  let otherPrs = $derived(prInfo ? prStore.getPrs(sessionId).filter((p) => p.number !== prInfo.number) : []);
  let otherPrsOpen = $state(false);

  // ── PR watching: alerts + auto mode ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let prFetchFailed = $derived(prStore.fetchFailedBySession[sessionId] ?? false);
  // Each alert shows on its step's row; one that needs you gets its own.
  let ciAlert = $derived(prAlerts.find((a) => a.kind === 'ci_failed'));
  let commentsAlert = $derived(prAlerts.find((a) => a.kind === 'new_comments'));
  let humanAlert = $derived(prAlerts.find((a) => a.kind === 'needs_human'));

  /** Only an open PR is watched (see detectPrEvents), so only an open one
   *  gets the agent actions and automation. */
  let prOpen = $derived(prInfo?.state === 'OPEN');
  let checks = $derived(prInfo?.checks);
  /** The failed GitHub Actions jobs, by run: each with its log, each run
   *  with a rerun. */
  let failingRuns = $derived(prInfo?.failingRuns ?? []);
  /** Failing checks with no Actions job here to show: other CI services',
   *  whose logs are with the service that ran them. Without failing runs,
   *  every failing check. */
  let otherFailing = $derived(failingRuns.length > 0 ? (prInfo?.otherFailingChecks ?? []) : (prInfo?.failingChecks ?? []));
  let runningChecks = $derived(prInfo?.runningChecks ?? []);
  let canFixCi = $derived(prOpen && (checks?.failed ?? 0) > 0);
  let canAddressReviews = $derived(prOpen && (prInfo?.reviewDecision === 'CHANGES_REQUESTED' || !!commentsAlert));
  let base = $derived(prInfo?.baseRefName ?? 'the base branch');

  /** What an action said when it couldn't go ahead: the agent busy, a log
   *  that couldn't be read. Under the Next notice. */
  let notice = $state<string | null>(null);
  let addressingReviews = $state(false);
  let loadingLog = $state<string | null>(null);

  // Shown only while the popup is open, so going counts as having looked.
  onDestroy(() => prStore.markAlertsSeen(sessionId));

  function fixCi() {
    notice = null;
    if (prStore.fixCiWithAgent(sessionId)) onclose();
    else notice = 'The agent is busy: try again when it goes idle';
  }

  async function addressReviews() {
    if (addressingReviews) return;
    addressingReviews = true;
    notice = null;
    try {
      const result = await prStore.addressReviewsWithAgent(sessionId);
      if (result === 'sent') onclose();
      else if (result === 'empty') notice = 'No review comments found on the PR';
      else notice = 'The agent is busy: try again when it goes idle';
    } catch {
      notice = 'Could not fetch review comments: check gh auth';
    } finally {
      addressingReviews = false;
    }
  }

  async function openLog(run: FailingRun, job: FailingJob) {
    if (loadingLog || !job.id) return;
    loadingLog = job.id;
    notice = null;
    try {
      await prStore.openJobLog(sessionId, run, job);
      // The log is in the Focus panel now. Left open, this popup would take
      // the first Escape and any click in the panel.
      onclose();
    } catch (e) {
      notice = errorMessage(e, 'Could not read the log');
    } finally {
      loadingLog = null;
    }
  }

  async function rerun(run: FailingRun) {
    notice = null;
    try {
      await prStore.rerunFailedJobs(sessionId, run);
    } catch (e) {
      notice = errorMessage(e, 'Rerun failed');
    }
  }

  function rerunTitle(run: FailingRun, state: 'requesting' | 'requested' | undefined): string {
    if (state === 'requested') return 'Rerun requested. The checks show it once GitHub starts it';
    if (run.pending) return 'Wait for this run to finish: GitHub reruns failed jobs only once every job in it is done';
    return 'Rerun this run\'s failed jobs, and the jobs that need them, on GitHub';
  }

  function openPr() {
    if (prInfo) void window.groveBench.openExternal(prInfo.url);
  }

  const AGENT_BUSY = 'The agent must be idle and running';

  function duration(seconds: number | undefined): string {
    if (seconds === undefined) return '';
    const m = Math.floor(seconds / 60);
    return m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`;
  }

  /** One reviewer's latest review, in words and its colour. */
  function reviewWords(r: PrReviewer): { text: string; tone: string } {
    if (r.state === 'approved') return { text: 'approved', tone: 'text-green-400' };
    if (r.state === 'changes_requested') return { text: 'requested changes', tone: 'text-status-attention' };
    return { text: 'commented', tone: 'text-muted-foreground' };
  }

  let checksText = $derived(
    !checks ? 'No checks reported'
      : checks.failed > 0 ? `${checks.failed} of ${plural(checks.total, 'check')} failed`
      : checks.pending > 0 ? `${checks.pending} of ${plural(checks.total, 'check')} running`
      : `${plural(checks.passed, 'check')} passed`,
  );

  let reviewText = $derived(
    prInfo?.reviewDecision === 'APPROVED' ? 'Approved'
      : prInfo?.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested'
      : prInfo?.reviewDecision === 'REVIEW_REQUIRED' ? 'No approving review yet'
      : 'No review required',
  );

  /** The merge row: GitHub's verdict in words, and its colour. */
  let mergeRow = $derived.by((): { text: string; tone: string } => {
    if (!prInfo) return { text: '', tone: '' };
    if (prInfo.state === 'MERGED') return { text: 'Merged', tone: 'text-purple-400' };
    if (prInfo.state === 'CLOSED') return { text: 'Closed without merging', tone: 'text-muted-foreground' };
    if (prInfo.isDraft) return { text: 'Draft: not ready for review yet', tone: 'text-muted-foreground' };
    // What stands in the way first: auto-merge waits on it too.
    if (prInfo.mergeState === 'dirty') return { text: `Conflicts with ${base}`, tone: 'text-status-attention' };
    if (prInfo.mergeState === 'behind') return { text: `Behind ${base}: update the branch first`, tone: 'text-status-attention' };
    if (prInfo.autoMerge) return { text: 'Auto-merge is on', tone: 'text-foreground' };
    switch (prInfo.mergeState) {
      case 'clean':
      case 'has_hooks': return { text: 'Nothing stops the merge', tone: 'text-foreground' };
      case 'unstable': return { text: 'Can merge; some checks that aren\'t required failed', tone: 'text-foreground' };
      case 'blocked': return { text: 'Blocked by a required review, check or rule', tone: 'text-muted-foreground' };
      default: return { text: 'GitHub hasn\'t said yet whether it can merge', tone: 'text-muted-foreground' };
    }
  });

  let syncText = $derived(
    pushFailed ? 'Push failed'
      : sync.ahead > 0 || sync.behind > 0
        ? [sync.ahead > 0 && `${sync.ahead} to push`, sync.behind > 0 && `${sync.behind} to pull`].filter(Boolean).join(' · ')
        : sync.upstream ? 'Up to date with origin'
        // No upstream recorded (pushed without -u, or the sync not read yet),
        // but a PR stands on the pushed branch.
        : prInfo ? 'Pushed' : 'Not pushed yet',
  );

  /** The "new" chips: amber, as a caution, and a button, since a click
   *  clears them. */
  const newChip = badgeVariants({ tone: 'warning', variant: 'soft', class: 'shrink-0 hover:bg-current/20 transition-colors' });
  const detail = 'pl-3.5 text-muted-foreground';
</script>

{#snippet nextActions()}
  {@render nextAction(next?.action)}
{/snippet}

{#snippet nextAction(action: ShipAction | undefined)}
  {#if action === 'retry-push'}
    <Button size="xs" onclick={onretrypush} disabled={retrying || pushing} class="disabled:cursor-wait">{retrying ? 'Pushing…' : 'Retry push'}</Button>
  {:else if action === 'push'}
    <Button size="xs" onclick={onpush} disabled={pushing} class="disabled:cursor-wait" title="Push this branch's commits to its upstream">
      {pushing ? 'Pushing…' : `Push ${plural(sync.ahead, 'commit')}`}
    </Button>
  {:else if action === 'create-pr'}
    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="xs"
        onclick={() => oncreatepr('agent')}
        disabled={!canAgentCreatePr || preparingPrTurn}
        class="disabled:cursor-not-allowed"
        title={!canAgentCreatePr ? 'The agent must be idle and running to take this turn' : 'Send a turn asking the agent to commit, push, and open the PR'}
      >
        Create PR with agent
      </Button>
      <!-- Waits for the turn like the agent's, so the push can't catch the
           agent part way through committing. -->
      <Button
        size="xs"
        variant="quiet"
        onclick={() => oncreatepr('manual')}
        disabled={isRunning}
        class="disabled:cursor-not-allowed"
        title={isRunning ? 'Create a pull request once the agent finishes its turn' : 'Open the PR dialog: title and description prefilled from the branch\'s commits'}
      >
        Create PR manually…
      </Button>
    </div>
  {:else if action === 'fix-ci'}
    <Button size="xs" onclick={fixCi} disabled={!canAgentCreatePr} class="disabled:cursor-not-allowed" title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : AGENT_BUSY}>
      Fix with agent
    </Button>
  {:else if action === 'address-reviews'}
    <Button size="xs" onclick={addressReviews} disabled={!canAgentCreatePr || addressingReviews} class="disabled:cursor-not-allowed" title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : AGENT_BUSY}>
      {addressingReviews ? 'Fetching…' : 'Address with agent'}
    </Button>
  {:else if action === 'merge-on-github'}
    <Button size="xs" variant="external" onclick={openPr} title="Merge it on GitHub">Merge on GitHub<ExternalLink class="size-3" /></Button>
  {:else if action === 'open-pr'}
    <Button size="xs" variant="external" onclick={openPr}>Open on GitHub<ExternalLink class="size-3" /></Button>
  {/if}
{/snippet}

{#if prFetchFailed}
  <p class="text-amber-500 mb-2" title="The last gh fetch failed: check network and gh auth status">
    May be out of date: the last GitHub fetch failed
  </p>
{/if}

<!-- The one thing to do now, with the popup's one main action. -->
{#if next}
  <SectionLabel class="mb-1">Next</SectionLabel>
  <Notice
    tone={next.tone === 'wait' ? 'info' : 'success'}
    title={next.headline}
    layout="stacked"
    actions={next.action ? nextActions : undefined}
    data-testid="next"
  >
    {#if next.detail}<p>{next.detail}</p>{/if}
  </Notice>
{/if}
{#if notice}
  <p class="text-amber-500 mt-1" role="status">{notice}</p>
{/if}

<div class="mt-2 divide-y divide-border" aria-label="Steps to merged" role="list">
  <!-- The branch against origin. -->
  <div class="flex items-center gap-2 py-1.5" role="listitem">
    <ShipDot state={stepState('push')} />
    <span class={pushFailed ? 'text-red-400' : 'text-foreground'}>{syncText}</span>
    {#if sync.ahead > 0 && !pushFailed && next?.action !== 'push'}
      <Button size="2xs" variant="subtle" class="ml-auto" onclick={onpush} disabled={pushing} title="Push this branch's commits to its upstream">
        {pushing ? 'Pushing…' : 'Push'}
      </Button>
    {/if}
  </div>

  {#if !prInfo || (showCreatePr && next?.action !== 'create-pr')}
    <!-- A PR to make: Next offers it when it's the step to take; here
         otherwise, in grey, so it's never out of reach. -->
    <div class="flex items-center gap-2 py-1.5" role="listitem" data-testid="step-pr">
      <ShipDot state={prInfo ? 'todo' : stepState('pr')} />
      <span class="text-muted-foreground">{prInfo ? 'No open PR' : 'No PR yet'}</span>
      {#if showCreatePr && next?.action !== 'create-pr'}
        <span class="ml-auto flex shrink-0 items-center gap-1">
          <Button size="2xs" variant="subtle" onclick={() => oncreatepr('agent')} disabled={!canAgentCreatePr || preparingPrTurn} title={!canAgentCreatePr ? 'The agent must be idle and running to take this turn' : 'Send a turn asking the agent to commit, push, and open the PR'}>
            Create PR with agent
          </Button>
          <Button size="2xs" variant="quiet" onclick={() => oncreatepr('manual')} disabled={isRunning} title={isRunning ? 'Create a pull request once the agent finishes its turn' : 'Open the PR dialog: title and description prefilled from the branch\'s commits'}>
            manually…
          </Button>
        </span>
      {/if}
    </div>
  {/if}
  {#if prInfo}
    <!-- Checks -->
    <div class="py-1.5" role="listitem" data-testid="step-checks">
      <div class="flex items-center gap-2 min-w-0">
        <ShipDot state={stepState('checks')} />
        <span class={checks && checks.failed > 0 && prOpen ? 'text-red-400' : 'text-foreground'}>{checksText}</span>
        {#if ciAlert}
          {@const ci = ciAlert}
          <button onclick={() => prStore.dismissAlert(sessionId, ci.id)} class={newChip} title="Failed since you last looked. Click to clear">new</button>
        {/if}
        {#if canFixCi && next?.action !== 'fix-ci'}
          <Button size="2xs" variant="subtle" class="ml-auto shrink-0" onclick={fixCi} disabled={!canAgentCreatePr} title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : AGENT_BUSY}>
            Fix with agent
          </Button>
        {/if}
      </div>
      {#each failingRuns as run (run.runId)}
        {@const rerunState = prStore.getRerun(sessionId, run.runId)}
        {#each run.jobs as job, i (job.id ?? job.name)}
          <div class="{detail} flex items-center gap-2 min-w-0" data-testid="failed-job">
            <span class="min-w-0 truncate" title="GitHub Actions run {run.runId}">{run.workflow ?? 'Actions'} / <span class="text-red-400">{job.name}</span></span>
            {#if job.seconds !== undefined}<span class="text-caption shrink-0">{duration(job.seconds)}</span>{/if}
            <span class="ml-auto flex shrink-0 items-center gap-2">
              {#if job.id}
                <Button variant="link" size="inline" class="disabled:no-underline" onclick={() => openLog(run, job)} disabled={loadingLog !== null} title="Read the end of this job's log">
                  {loadingLog === job.id ? 'loading…' : 'log'}
                </Button>
              {/if}
              {#if i === 0 && prOpen}
                <Button
                  variant="quiet"
                  size="inline"
                  class="disabled:cursor-not-allowed"
                  onclick={() => rerun(run)}
                  disabled={run.pending || rerunState !== undefined}
                  title={rerunTitle(run, rerunState)}
                >
                  {rerunState === 'requesting' ? 'asking…' : rerunState === 'requested' ? 'rerun requested' : 'rerun'}
                </Button>
              {/if}
            </span>
          </div>
        {/each}
      {/each}
      {#if otherFailing.length > 0}
        <div
          class="{detail} truncate"
          title="{otherFailing.join(', ')}{failingRuns.length > 0 ? '. Not GitHub Actions jobs of this repository: their logs are with the service that ran them' : ''}"
        >
          <span class="text-red-400">{otherFailing.join(', ')}</span>
        </div>
      {/if}
      {#if runningChecks.length > 0}
        <div class="{detail} truncate" title={runningChecks.join(', ')}>
          {runningChecks.slice(0, 3).join(', ')}{runningChecks.length > 3 ? ` and ${runningChecks.length - 3} more` : ''} <span class="text-status-working">running</span>
        </div>
      {/if}
      {#if prOpen}
        <label class="{detail} mt-1 flex items-center gap-1.5 cursor-pointer hover:text-foreground" title="When CI fails, send a fix turn automatically, while the thread is idle. After 2 tries without CI going green, it asks for you. git push and gh may need to be allowed">
          <Checkbox class="size-3.5" checked={prAuto.fixCi} onCheckedChange={(v) => prStore.setAuto(sessionId, { fixCi: v === true })} />
          Fix automatically when checks fail
        </label>
      {/if}
    </div>

    <!-- Review -->
    <div class="py-1.5" role="listitem" data-testid="step-review">
      <div class="flex items-center gap-2 min-w-0">
        <ShipDot state={stepState('review')} />
        <span class={prInfo.reviewDecision === 'CHANGES_REQUESTED' && prOpen ? 'text-status-attention' : 'text-foreground'}>{reviewText}</span>
        {#if commentsAlert}
          {@const ca = commentsAlert}
          <button onclick={() => prStore.dismissAlert(sessionId, ca.id)} class={newChip} title="{ca.count} new comment{ca.count > 1 ? 's' : ''} since you last looked. Click to clear">
            {ca.count} new
          </button>
        {/if}
        {#if canAddressReviews && next?.action !== 'address-reviews'}
          <Button size="2xs" variant="subtle" class="ml-auto shrink-0" onclick={addressReviews} disabled={!canAgentCreatePr || addressingReviews} title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : AGENT_BUSY}>
            {addressingReviews ? 'Fetching…' : 'Address with agent'}
          </Button>
        {/if}
      </div>
      {#if prInfo.reviewers?.length}
        <div class={detail}>
          {#each prInfo.reviewers as r, i (r.login)}
            {@const words = reviewWords(r)}
            {i > 0 ? ' · ' : ''}{r.login} <span class={words.tone}>{words.text}</span>
          {/each}
        </div>
      {/if}
      {#if prInfo.requestedReviewers?.length}
        <div class="{detail} truncate" title="Review asked of {prInfo.requestedReviewers.join(', ')}">Asked of {prInfo.requestedReviewers.join(', ')}</div>
      {:else if prInfo.reviewDecision === 'REVIEW_REQUIRED' && !prInfo.reviewers?.length && next?.step !== 'review'}
        <div class={detail}>{base} needs an approving review to merge.</div>
      {/if}
      {#if prOpen}
        <label class="{detail} mt-1 flex items-center gap-1.5 cursor-pointer hover:text-foreground" title="When repository collaborators leave new review feedback, send a turn to address it automatically, while the thread is idle">
          <Checkbox class="size-3.5" checked={prAuto.addressReviews} onCheckedChange={(v) => prStore.setAuto(sessionId, { addressReviews: v === true })} />
          Address new comments automatically
        </label>
      {/if}
    </div>

    <!-- Merge: GitHub's own verdict. -->
    <div class="flex items-center gap-2 py-1.5" role="listitem" data-testid="step-merge">
      <ShipDot state={stepState('merge')} />
      <span class={mergeRow.tone}>{mergeRow.text}</span>
    </div>
  {/if}
</div>

{#if humanAlert}
  {@const ha = humanAlert}
  <div class="flex items-center gap-2 mt-2 text-amber-500">
    <span class="size-1.5 bg-current shrink-0"></span>
    <span class="flex-1" title={ha.reason}>{ha.reason}</span>
    <Button variant="quiet" size="icon-2xs" onclick={() => prStore.dismissAlert(sessionId, ha.id)} title="Dismiss" aria-label="Dismiss">
      <XIcon />
    </Button>
  </div>
{/if}

<!-- Other PRs tied to this thread: a replaced PR on the same branch, a
     stacked PR into another base, or one the agent opened from a second
     branch. Only the primary is watched; "watch" swaps it. Folded, as they
     rarely need you. -->
{#if otherPrs.length > 0}
  <div class="mt-1">
    <Button
      variant="quiet"
      size="xs"
      class="-ml-1.5"
      onclick={() => (otherPrsOpen = !otherPrsOpen)}
      aria-expanded={otherPrsOpen}
      title="Alerts and auto turns follow one PR at a time"
    >
      <ChevronRight class="size-3 transition-transform {otherPrsOpen ? 'rotate-90' : ''}" />
      {plural(otherPrs.length, 'other PR')} in this thread
    </Button>
    {#if otherPrsOpen}
      <div class="space-y-0.5 pl-3.5">
        {#each otherPrs as other (other.number)}
          {@const otherHealth = prHealth(other)}
          <div class="flex items-center gap-2">
            <span class="size-1.5 {otherHealth.bgClass} shrink-0"></span>
            <span
              class="flex-1 min-w-0 truncate text-muted-foreground"
              title="{other.title ? `${other.title}: ` : ''}{other.headRefName ?? '?'} → {other.baseRefName ?? '?'} ({otherHealth.label})"
            ><span class="text-foreground">#{other.number}</span> {other.isDraft ? 'draft' : (other.state ?? 'open').toLowerCase()}{other.title ? `: ${other.title}` : ''}</span>
            <Button
              variant="link"
              size="inline"
              onclick={() => prStore.setPrimary(sessionId, other.number)}
              title="Follow this PR instead: the branch's steps, alerts, and auto turns switch to it"
            >
              watch
            </Button>
            <Button variant="external" size="icon-2xs" onclick={() => window.groveBench.openExternal(other.url)} title="Open #{other.number} on GitHub" aria-label="Open #{other.number} on GitHub">
              <ExternalLink />
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
