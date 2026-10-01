<script lang="ts">
  /**
   * The branch stack: project / branch on top (click the branch to switch);
   * underneath, its sync state (ahead / behind / push error) and the PR for
   * this branch: "Create PR" before one exists, the PR pill once it does.
   * The stack anchors every popover here, so they open above all of it.
   * Also keeps the PR and sync status polled while the bar is mounted.
   */
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { buildCreatePrPrompt } from '../lib/pr-prompt.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import BranchPicker from './BranchPicker.svelte';
  import StatusBarPopover from './StatusBarPopover.svelte';
  import StatusBarPr from './StatusBarPr.svelte';

  let { sessionId }: { sessionId: string } = $props();

  // The dialog loads when first opened.
  const loadCreatePrDialog = lazyComponent(() => import('./CreatePrDialog.svelte'));

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let sessionBranch = $derived(session?.branch ?? '');
  let sessionDirect = $derived(session?.direct === true);
  let sessionRepoPath = $derived(session?.repoPath ?? '');
  let sessionStatus = $derived(session?.status);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** The agent path to creating a PR needs a live, idle session. */
  let canAgentCreatePr = $derived(sessionStatus === 'running' && !isRunning);

  /** The primary PR: what the pill, alerts, and automation follow. */
  let prInfo = $derived(prStore.getPr(sessionId));
  let gitSync = $derived(prStore.getSync(sessionId));
  let ghAvailable = $derived(store.prerequisites?.gh?.available === true);
  let showCreatePr = $derived(!prInfo && !!sessionBranch && ghAvailable);

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

  // ── Polling ──
  // Poll PR + branch sync status while this status bar is mounted
  $effect(() => prStore.watch(sessionId));

  // Re-fetch PR info when a turn finishes (agent may have committed/pushed/created a PR)
  let prevRunning = $state(false);
  $effect(() => {
    if (prevRunning && !isRunning) {
      prStore.refresh(sessionId, true);
    }
    prevRunning = isRunning;
  });

  // Ahead/behind counts belong to the branch shown next to them: re-fetch when
  // it changes (e.g. the agent switched mid-turn). Not forced, so a picker
  // switch that already refreshed doesn't fetch twice.
  let prevBranch = '';
  $effect(() => {
    const branch = sessionBranch;
    if (prevBranch && branch && branch !== prevBranch) prStore.refresh(sessionId);
    prevBranch = branch;
  });

  // ── Branch picker ──
  let branchPickerOpen = $state(false);

  // A turn starting mid-pick would switch files under the agent.
  $effect(() => {
    if (isRunning) branchPickerOpen = false;
  });

  // ── Creating a PR ──
  let createPrMenuOpen = $state(false);
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
    createPrMenuOpen = false;
    if (how === 'agent') sendAgentPrTurn();
    else createPrOpen = true;
  }

  /** Default click: agent turn when the session can take one, manual dialog otherwise. */
  function startCreatePr() {
    createPr(canAgentCreatePr ? 'agent' : 'manual');
  }
</script>

{#if sessionBranch || gitSync.ahead > 0 || gitSync.behind > 0 || pushError || prInfo}
  <div class="relative flex flex-col gap-px leading-snug min-w-0">
    {#if sessionBranch}
      <div class="flex items-center gap-1 min-w-0">
        {#if sessionRepoPath}
          <span class="hidden @3xl:inline text-muted-foreground/50 truncate max-w-28" title={sessionRepoPath}>
            {store.repoDisplayName(sessionRepoPath)}
          </span>
          <span class="hidden @3xl:inline text-muted-foreground/30 shrink-0">/</span>
        {/if}
        <StatusBarPopover bind:open={branchPickerOpen} anchored={false} animate panelClass="" class="flex min-w-0">
          {#snippet trigger()}
            <button
              onclick={() => branchPickerOpen = !branchPickerOpen}
              disabled={isRunning}
              class="text-muted-foreground/70 hover:text-foreground truncate max-w-40 transition-colors border-b border-dashed border-muted-foreground/40 disabled:border-transparent disabled:hover:text-muted-foreground/70"
              title={`${sessionRepoPath ? `${store.repoDisplayName(sessionRepoPath)} / ` : ''}${sessionBranch}${isRunning
                ? ' (switch branches once the agent finishes its turn)'
                : ': click to switch branch'}`}
              aria-expanded={branchPickerOpen}
            >
              {sessionBranch}
            </button>
          {/snippet}

          <BranchPicker
            {sessionId}
            repoPath={sessionRepoPath}
            currentBranch={sessionBranch}
            direct={sessionDirect}
            onclose={() => branchPickerOpen = false}
          />
        </StatusBarPopover>
      </div>
    {/if}

    {#if gitSync.ahead > 0 || gitSync.behind > 0 || pushError || prInfo || showCreatePr}
      <div class="flex items-center gap-2 text-[11px] whitespace-nowrap">
        {#if gitSync.ahead > 0}
          <button
            onclick={doPush}
            disabled={pushing}
            class="flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors disabled:opacity-50"
            title={pushing ? 'Pushing…' : `${gitSync.ahead} unpushed commit${gitSync.ahead > 1 ? 's' : ''} — click to push`}
          >
            {pushing ? 'pushing…' : `↑${gitSync.ahead}`}
          </button>
        {/if}

        {#if gitSync.behind > 0}
          <span class="text-muted-foreground/70" title="{gitSync.behind} commit{gitSync.behind > 1 ? 's' : ''} behind upstream (as of last fetch)">
            ↓{gitSync.behind}
          </span>
        {/if}

        {#if pushError}
          <button
            onclick={() => prStore.dismissPushError(sessionId)}
            class="text-red-400 hover:text-red-300 truncate max-w-32 transition-colors"
            title={`${pushError}\n\nClick to dismiss`}
          >
            push failed
          </button>
        {/if}

        {#if prInfo}
          <StatusBarPr {sessionId} {prInfo} {preparingPrTurn} oncreatepr={createPr} />
        {:else if showCreatePr}
          <StatusBarPopover bind:open={createPrMenuOpen} anchored={false} panelClass="bg-popover border border-border shadow-xl py-1 text-xs w-48">
            {#snippet trigger()}
              <span class="flex items-center">
                <button
                  onclick={startCreatePr}
                  disabled={isRunning || preparingPrTurn}
                  class="text-blue-400 hover:text-blue-300 hover:underline transition-colors disabled:opacity-50 disabled:no-underline"
                  title={isRunning
                    ? 'Create a pull request once the agent finishes its turn'
                    : canAgentCreatePr
                      ? 'Ask the agent to commit, push, and create a pull request in this conversation'
                      : 'Push this branch and create a pull request'}
                >
                  Create PR
                </button>
                <button
                  data-popover-trigger
                  onclick={() => createPrMenuOpen = !createPrMenuOpen}
                  class="ml-0.5 text-blue-400/70 hover:text-blue-300 transition-colors"
                  title="Create PR options"
                  aria-label="Create PR options"
                  aria-expanded={createPrMenuOpen}
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
              </span>
            {/snippet}

            <button
              onclick={() => createPr('agent')}
              disabled={!canAgentCreatePr}
              class="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={canAgentCreatePr ? 'Send a turn asking the agent to commit, push, and open the PR' : 'The agent must be idle and running to take this turn'}
            >
              Create with agent
            </button>
            <!-- Waits for the turn like the Create PR link beside it, so the
                 push can't catch the agent part way through committing. -->
            <button
              onclick={() => createPr('manual')}
              disabled={isRunning}
              class="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={isRunning
                ? 'Create a pull request once the agent finishes its turn'
                : 'Open the PR dialog — title and description prefilled from the branch\'s commits'}
            >
              Create manually…
            </button>
          </StatusBarPopover>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if createPrOpen}
  {#await loadCreatePrDialog() then CreatePrDialog}
    <CreatePrDialog {sessionId} onclose={() => createPrOpen = false} />
  {/await}
{/if}
