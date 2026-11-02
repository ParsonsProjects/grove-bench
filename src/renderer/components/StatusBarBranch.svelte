<script lang="ts">
  /**
   * The branch lozenge: one icon for where the branch is on its way to
   * merged (ShipIcon: its shape the stage, its colour the step that matters
   * most; lib/ship-track.ts), then the branch's name.
   * A green mark at its end says the popup holds something to do now
   * (ship-track's Next: push, create a PR, fix failed checks, address
   * requested changes, conflicts, a branch behind its base, or a PR GitHub
   * says is ready to merge). A merge or rebase stopped part way adds its
   * word in amber ("rebasing 1/2").
   *
   * Its popup: the PR and where it goes, then StatusBarSteps (the Next
   * notice with the one main action, and a row per step), a failed push's
   * error, and Switch branch (the branch picker, which opens over the
   * lozenge in its place). Push and Create PR are actions of the Next
   * notice, or, when they aren't next, of the branch row and the PR row.
   * Also keeps the PR and sync status polled while the bar is mounted.
   */
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { operationShort, operationTitle } from '../lib/git-operation.js';
  import { threadWorking } from '../lib/thread-working.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { buildCreatePrPrompt } from '../lib/pr-prompt.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import { lozenge, lozengeMark } from '../lib/lozenge.js';
  import { shipTrack } from '../lib/ship-track.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import BranchPicker from './BranchPicker.svelte';
  import CopyButton from './CopyButton.svelte';
  import StatusBarPopover from './StatusBarPopover.svelte';
  import StatusBarSteps from './StatusBarSteps.svelte';
  import ShipIcon from './ShipIcon.svelte';

  let { sessionId }: { sessionId: string } = $props();

  // The dialog loads when first opened.
  const loadCreatePrDialog = lazyComponent(() => import('./CreatePrDialog.svelte'));

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let sessionBranch = $derived(session?.branch ?? '');
  let sessionDirect = $derived(session?.direct === true);
  let sessionRepoPath = $derived(session?.repoPath ?? '');
  let sessionStatus = $derived(session?.status);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** A switch moves files under any agent at work here, a background one too
   *  (the picker tells main the same, which refuses it). */
  let working = $derived(threadWorking(sessionId));
  /** A merge, rebase, cherry-pick or revert stopped part way in the worktree. */
  let operation = $derived(gitStatusStore.getStatus(sessionId).operation);
  function openChanges() {
    shipOpen = false;
    messageStore.setActiveTab(sessionId, 'changes');
    void gitStatusStore.refresh(sessionId);
  }
  /** The agent path to creating a PR needs a live, idle session. */
  let canAgentCreatePr = $derived(sessionStatus === 'running' && !isRunning);

  /** The primary PR: what the pill, alerts, and automation follow. */
  let prInfo = $derived(prStore.getPr(sessionId));
  let gitSync = $derived(prStore.getSync(sessionId));
  let ghAvailable = $derived(store.prerequisites?.gh?.available === true);
  /** None of the thread's PRs is open: none yet, or the last one was merged
   *  or closed, so more work on the branch needs a new one. */
  let noOpenPr = $derived(!prStore.getPrs(sessionId).some((p) => p.state === 'OPEN' || !p.state));
  let showCreatePr = $derived(noOpenPr && !!sessionBranch && ghAvailable);

  // ── Push ──
  let pushing = $state(false);
  /** The last failed push from here or the Changes tab. The store drops it
   *  once nothing is left to push or the branch changes. */
  let pushError = $derived(prStore.getPushError(sessionId));

  async function doPush() {
    if (pushing) return;
    pushing = true;
    try {
      await prStore.push(sessionId);
    } catch {
      // Kept in prStore and shown as "push failed".
    } finally {
      pushing = false;
    }
  }

  // A failed push shows its error in the popup, with Retry and Dismiss. The
  // store clears the error as a push starts, so the popup keeps showing the
  // last one while a retry runs, then drops it if it went through.
  let retrying = $state(false);
  let shownPushError = $state('');
  $effect(() => { if (pushError) shownPushError = pushError; });

  async function retryPush() {
    retrying = true;
    try {
      await doPush();
    } finally {
      retrying = false;
    }
  }

  // ── Polling ──
  // Poll PR + branch sync status while this status bar is mounted
  $effect(() => prStore.watch(sessionId));

  // Re-fetch PR info when a turn finishes (agent may have committed/pushed/created a PR)
  let prevRunning = $state(false);
  $effect(() => {
    if (prevRunning && !isRunning) {
      void prStore.refresh(sessionId, true);
    }
    prevRunning = isRunning;
  });

  // Ahead/behind counts belong to the branch shown next to them: re-fetch when
  // it changes (e.g. the agent switched mid-turn). Not forced, so a picker
  // switch that already refreshed doesn't fetch twice.
  let prevBranch = '';
  $effect(() => {
    const branch = sessionBranch;
    if (prevBranch && branch && branch !== prevBranch) void prStore.refresh(sessionId);
    prevBranch = branch;
  });

  // ── The popup and the branch picker ──
  let shipOpen = $state(false);
  let branchPickerOpen = $state(false);

  // A turn starting mid-pick would switch files under the agent.
  $effect(() => {
    if (working) branchPickerOpen = false;
  });

  /** The picker opens over the lozenge in the popup's place; a click on
   *  the lozenge while it is open closes it. */
  function toggleShip() {
    if (branchPickerOpen) branchPickerOpen = false;
    else shipOpen = !shipOpen;
  }

  function openBranchPicker() {
    shipOpen = false;
    branchPickerOpen = true;
  }

  // ── The ship track ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let prFetchFailed = $derived(prStore.fetchFailedBySession[sessionId] ?? false);
  let otherPrCount = $derived(prInfo ? prStore.getPrs(sessionId).filter((p) => p.number !== prInfo.number).length : 0);
  let track = $derived(shipTrack({ sync: gitSync, pr: prInfo, pushFailed: !!pushError, canCreatePr: showCreatePr }));
  let repoName = $derived(sessionRepoPath ? store.repoDisplayName(sessionRepoPath) : '');
  /** The PR's state on its badge: neutral while open (green is for acting
   *  and finishing), purple once merged, as merged PRs are. */
  let prBadge = $derived<{ tone: 'neutral' | 'muted' | 'accent'; label: string }>(
    prInfo?.state === 'MERGED' ? { tone: 'accent', label: 'merged' }
      : prInfo?.state === 'CLOSED' ? { tone: 'muted', label: 'closed' }
      : prInfo?.isDraft ? { tone: 'muted', label: 'draft' }
      : { tone: 'neutral', label: 'open' },
  );
  /** The lozenge's icon is shape and colour only: the tooltip says it in words. */
  let lozengeTitle = $derived.by(() => {
    const parts = [`${repoName ? `${repoName} / ` : ''}${sessionBranch || 'no branch'}: ${track.summary}`];
    if (operation) parts.push(`${operationTitle(operation)} stopped part way`);
    if (prAlerts.length > 0) parts.push('new PR activity');
    if (prFetchFailed) parts.push('may be out of date, the last GitHub fetch failed');
    // Saved across restarts, so say when it is on rather than leave it hidden.
    const auto = [prAuto.fixCi && 'fix CI', prAuto.addressReviews && 'address reviews'].filter(Boolean);
    if (prInfo?.state === 'OPEN' && auto.length > 0) parts.push(`auto: ${auto.join(' + ')}`);
    if (otherPrCount > 0) parts.push(`+${otherPrCount} more PR${otherPrCount === 1 ? '' : 's'} in this thread`);
    return `${parts.join(', ')}. Click to push, open a pull request or switch branch`;
  });

  // ── Creating a PR ──
  let createPrOpen = $state(false);

  /** Set while the PR turn is being prepared (the base branch lookup runs
   *  git), so a double click can't send it twice. */
  let preparingPrTurn = $state(false);

  /** Hand PR creation to the agent as a turn in this conversation. */
  async function sendAgentPrTurn() {
    if (preparingPrTurn) return;
    preparingPrTurn = true;
    try {
      const base = await resolveBaseBranch(sessionRepoPath);
      const prompt = buildCreatePrPrompt(sessionBranch, base);
      messageStore.addUserMessage(sessionId, prompt);
      window.groveBench.sendMessage(sessionId, prompt);
      store.updateLastActive(sessionId);
    } finally {
      preparingPrTurn = false;
    }
  }

  function createPr(how: 'agent' | 'manual') {
    shipOpen = false;
    if (how === 'agent') void sendAgentPrTurn();
    else createPrOpen = true;
  }
</script>

{#if sessionBranch || prInfo || pushError || gitSync.ahead > 0 || gitSync.behind > 0}
  <!-- The picker opens above the lozenge, so the popup's popover is its trigger. -->
  <StatusBarPopover bind:open={branchPickerOpen} animate surface="none" panelClass="" class="flex min-w-0">
    {#snippet trigger()}
      <StatusBarPopover bind:open={shipOpen} anchored={false} label="Branch" panelClass="w-96 max-h-[70vh] overflow-y-auto" testid="branch-popup" class="flex min-w-0">
        {#snippet trigger()}
          <button
            onclick={toggleShip}
            class={lozenge({ open: shipOpen || branchPickerOpen, class: 'max-w-full' })}
            title={lozengeTitle}
            aria-label="Branch {sessionBranch || 'none'}: {track.summary}{track.actionable ? ', something to do' : ''}{operation ? `, ${operationTitle(operation)} stopped part way` : ''}"
            aria-haspopup="dialog"
            aria-expanded={shipOpen}
            data-testid="branch"
          >
            <!-- Dimmed when the last GitHub fetch failed, so it may be old;
                 pulsing while there is PR activity you haven't looked at.
                 On a wrapper: the pulse only fades to half, so on the icon
                 itself a dimmed icon would hold still, checks running too. -->
            <span class="flex shrink-0 {prAlerts.length > 0 ? 'animate-pulse' : ''} {prFetchFailed ? 'opacity-50' : ''}" data-testid="ship-icon">
              <ShipIcon stage={track.stage} />
            </span>
            <span class="truncate max-w-16 @2xl:max-w-32 @4xl:max-w-48">{sessionBranch || 'no branch'}</span>
            {#if operation}
              <span class="text-status-attention">{operationShort(operation)}</span>
            {/if}
            {#if track.actionable}
              <span class={lozengeMark({ place: 'inside' })}></span>
            {/if}
          </button>
        {/snippet}

        <!-- The PR, then where it goes. -->
        {#if prInfo}
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-medium text-foreground shrink-0">#{prInfo.number}</span>
            {#if prInfo.title}<span class="truncate text-foreground" title={prInfo.title}>{prInfo.title}</span>{/if}
            <Badge tone={prBadge.tone} class="shrink-0">{prBadge.label}</Badge>
            <Button
              variant="external"
              size="icon-2xs"
              class="ml-auto shrink-0"
              onclick={() => window.groveBench.openExternal(prInfo.url)}
              title="Open #{prInfo.number} on GitHub"
              aria-label="Open #{prInfo.number} on GitHub"
            >
              <ExternalLink />
            </Button>
          </div>
        {/if}
        <div class="flex items-center gap-1 min-w-0 mb-3 text-muted-foreground">
          {#if repoName}
            <span class="truncate max-w-32 shrink-0" title={sessionRepoPath}>{repoName}</span>
            <span class="shrink-0">·</span>
          {/if}
          <!-- The PR's own head: it may be another branch than the thread's
               (a PR the agent opened from a second branch, or one watched). -->
          <span class="truncate {prInfo ? '' : 'font-medium text-foreground'}">{prInfo?.headRefName ?? (sessionBranch || 'no branch')}</span>
          {#if prInfo?.baseRefName}<span class="shrink-0">→ {prInfo.baseRefName}</span>{/if}
        </div>

        {#if operation}
          <!-- Noticed here from any tab, finished or aborted in the Changes
               tab (GitOperationNotice). -->
          <button
            class="mb-2 text-left text-status-attention hover:underline"
            title="Open the Changes tab to finish or abort it"
            onclick={openChanges}
          >
            {operationTitle(operation)} stopped part way: finish or abort it in the Changes tab
          </button>
        {/if}

        <StatusBarSteps
          {sessionId}
          {track}
          {prInfo}
          sync={gitSync}
          {canAgentCreatePr}
          {pushing}
          {retrying}
          {showCreatePr}
          {preparingPrTurn}
          {isRunning}
          onpush={doPush}
          onretrypush={retryPush}
          oncreatepr={createPr}
          onclose={() => (shipOpen = false)}
        />

        {#if pushError || retrying}
          <div class="mt-3 pt-2 border-t border-border" data-testid="push-error">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-medium text-foreground">Push failed</span>
              <CopyButton text={shownPushError} class="size-5 shrink-0" />
            </div>
            <pre class="font-mono text-caption text-red-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto mb-2">{shownPushError}</pre>
            <div class="flex justify-end">
              <Button
                variant="quiet"
                size="xs"
                onclick={() => prStore.dismissPushError(sessionId)}
                disabled={retrying}
              >
                Dismiss
              </Button>
            </div>
          </div>
        {/if}

        <div class="flex items-center mt-2 pt-2 border-t border-border">
          <Button
            variant="quiet"
            size="xs"
            class="ml-auto"
            onclick={openBranchPicker}
            disabled={working}
            title={working ? 'Switch branches once the agent finishes' : 'Switch to another branch, or create one'}
          >
            Switch branch…
          </Button>
        </div>

      </StatusBarPopover>
    {/snippet}

    <!-- The popover takes Escape first and hands focus back to the lozenge;
         BranchPicker's own Escape is for it on its own. -->
    <BranchPicker
      {sessionId}
      repoPath={sessionRepoPath}
      currentBranch={sessionBranch}
      direct={sessionDirect}
      onclose={() => (branchPickerOpen = false)}
    />
  </StatusBarPopover>
{/if}

{#if createPrOpen}
  {#await loadCreatePrDialog() then CreatePrDialog}
    <CreatePrDialog {sessionId} onclose={() => createPrOpen = false} />
  {/await}
{/if}
