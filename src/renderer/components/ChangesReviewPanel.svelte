<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import { reviewStore } from '../stores/review.svelte.js';
  import { backgroundAgentStore } from '../stores/background-agent.svelte.js';
  import type { GitStatusEntry, DiffScope, PrReviewEvent, PrReviewSubmitResult } from '../../shared/types.js';
  import ReviewDiffPanel from './ReviewDiffPanel.svelte';
  import { lazyComponent } from '../lib/lazy-component.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { stripIpcErrorPrefix } from '$lib/mcp-errors.js';

  /**
   * The Changes tab: git status (the whole branch since its base, by
   * default, or the uncommitted working tree) fed into the shared review
   * panel, plus the git client actions that only make sense here:
   * stage/unstage, revert, commit, branch operations, and reviewing the
   * thread's PR on GitHub.
   */
  let { sessionId }: { sessionId: string } = $props();

  /** Rebase / squash / cherry-pick dialog (branch operations between agent branches). */
  let gitOpsOpen = $state(false);
  const loadGitOpsDialog = lazyComponent(() => import('./GitOpsDialog.svelte'));

  let gitStatus = $derived(gitStatusStore.getStatus(sessionId));
  let isLoading = $derived(gitStatusStore.isLoading(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let stagedEntries = $derived(gitStatus.entries.filter(e => e.staged));

  // Scope: uncommitted working tree (git-client view) or everything on the
  // branch since it left the base (pull-request view).
  let scopeState = $derived(gitStatusStore.getScope(sessionId));
  let isBranchScope = $derived(scopeState.scope === 'branch');
  let switchingScope = $state(false);
  let sourceKey = $derived(isBranchScope ? `branch:${scopeState.base ?? ''}` : 'working');

  async function setScope(scope: DiffScope) {
    if (scope === scopeState.scope || switchingScope) return;
    switchingScope = true;
    try {
      let base = scopeState.base;
      if (scope === 'branch' && !base) {
        const session = sessionStore.sessions.find(s => s.id === sessionId);
        base = await resolveBaseBranch(session?.repoPath ?? '');
      }
      await gitStatusStore.setScope(sessionId, scope, base);
    } finally {
      switchingScope = false;
    }
  }

  /** Where line comments were written, so each shows only on its comparison.
   *  Named by the chosen base, not the resolved ref, which can move between
   *  `main` and `origin/main` and would hide comments already written. */
  let commentContext = $derived(isBranchScope ? `branch vs ${scopeState.base ?? gitStatus.baseRef ?? 'base'}` : undefined);

  // ── PR review (Branch view only, for the PR of the branch it shows) ──
  let reviewablePr = $derived(isBranchScope ? prStore.reviewablePr(sessionId) : null);
  let reviewState = $derived(reviewStore.bySession[sessionId]);
  let branchComments = $derived.by(() => {
    reviewState;
    if (!isBranchScope) return [];
    return reviewStore.getComments(sessionId).filter((c) => (c.context ?? '') === (commentContext ?? ''));
  });
  let reviewOpen = $state(false);
  const loadPrReviewDialog = lazyComponent(() => import('./PrReviewDialog.svelte'));
  let posted = $state<{ prNumber: number; event: PrReviewEvent; result: PrReviewSubmitResult } | null>(null);

  const POSTED_TEXT: Record<PrReviewEvent, string> = {
    APPROVE: 'Approved',
    REQUEST_CHANGES: 'Requested changes on',
    COMMENT: 'Commented on',
  };

  function onReviewPosted(prNumber: number, p: { event: PrReviewEvent; result: PrReviewSubmitResult; commentIds: string[] }) {
    reviewStore.removeComments(sessionId, p.commentIds);
    posted = { prNumber, event: p.event, result: p.result };
  }

  let emptyTitle = $derived(
    isBranchScope
      ? (gitStatus.scopeError ?? `No changes on this branch vs ${gitStatus.baseRef ?? scopeState.base ?? 'base'}`)
      : 'Working tree clean',
  );

  // Pass `staged` so the index-vs-HEAD and working-tree-vs-index diffs differ
  // for a path that appears in both the Staged and Changes sections. In branch
  // scope every file is diffed against the merge base instead.
  function loadDiff(entry: GitStatusEntry) {
    return window.groveBench.getFileDiff(
      sessionId, entry.filePath, entry.staged,
      isBranchScope && scopeState.base ? { base: scopeState.base } : undefined,
    );
  }
  function loadFileLines(entry: GitStatusEntry) {
    return window.groveBench.getFileLines(sessionId, entry.filePath, entry.staged);
  }

  // ── Staging ──
  function stageEntry(entry: GitStatusEntry) {
    gitStatusStore.stageFile(sessionId, entry.filePath).catch(e => console.error('Failed to stage:', e));
  }
  function unstageEntry(entry: GitStatusEntry) {
    gitStatusStore.unstageFile(sessionId, entry.filePath).catch(e => console.error('Failed to unstage:', e));
  }
  async function stageAll(entries: GitStatusEntry[]) {
    const paths = [...new Set(entries.map(e => e.filePath))];
    for (const p of paths) {
      try { await gitStatusStore.stageFile(sessionId, p); } catch (e) { console.error('Failed to stage:', e); }
    }
  }
  async function unstageAll(entries: GitStatusEntry[]) {
    const paths = [...new Set(entries.map(e => e.filePath))];
    for (const p of paths) {
      try { await gitStatusStore.unstageFile(sessionId, p); } catch (e) { console.error('Failed to unstage:', e); }
    }
  }

  // ── Commit ──
  let commitMessage = $state('');
  let committing = $state(false);
  let pushing = $state(false);
  let generatingMsg = $state(false);
  let commitError = $state('');

  async function generateMessage() {
    if (generatingMsg || committing || stagedEntries.length === 0) return;
    generatingMsg = true;
    commitError = '';
    try {
      // A thread whose agent is gone asks which agent to use first.
      const substitute = await backgroundAgentStore.substituteFor(sessionId, 'write a commit message');
      if (substitute === null) return;
      commitMessage = await window.groveBench.generateCommitMessage(sessionId, substitute);
    } catch (e: any) {
      commitError = e?.message || 'Failed to generate commit message';
    } finally {
      generatingMsg = false;
    }
  }

  async function doCommit(andPush = false) {
    if (!commitMessage.trim() || stagedEntries.length === 0 || committing) return;
    committing = true;
    commitError = '';
    let committed = false;
    try {
      await gitStatusStore.commit(sessionId, commitMessage);
      committed = true;
      commitMessage = '';
      if (andPush) {
        pushing = true;
        await prStore.push(sessionId);
      }
    } catch (e: any) {
      // A failed push after a good commit is kept by prStore and shown in
      // the status bar as "push failed": the commit box disappears once
      // nothing is staged, so an error here would never be seen.
      if (!committed) commitError = e?.message || 'Commit failed';
    } finally {
      committing = false;
      pushing = false;
    }
  }

  // With nothing staged the commit box is hidden. Drop any error then, so it
  // can't come back, out of date, with the next staged file.
  $effect(() => {
    if (stagedEntries.length === 0) commitError = '';
  });

  // ── Revert / discard (destructive, confirmed first) ──
  let confirmEntry = $state<GitStatusEntry | null>(null);
  let revertingFiles = $state<Set<string>>(new Set());
  /** Why the last revert failed, by the entry's key: git refuses, or main
   *  does (a rename whose old path is taken, or a file that changed since). */
  let revertError = $state<{ key: string; message: string } | null>(null);

  function confirmRevert() {
    const entry = confirmEntry;
    confirmEntry = null;
    if (entry) revertFile(entry);
  }

  async function revertFile(entry: GitStatusEntry) {
    const key = `${entry.filePath}:${entry.staged}`;
    revertingFiles = new Set([...revertingFiles, key]);
    revertError = null;
    try {
      // A rename's old path comes back; a copy's source was never removed.
      await gitStatusStore.revertFile(sessionId, entry.filePath, entry.staged, entry.status === 'renamed' ? entry.origPath : undefined);
    } catch (e) {
      revertError = { key, message: stripIpcErrorPrefix(e instanceof Error ? e.message : String(e)) };
    } finally {
      const next = new Set(revertingFiles);
      next.delete(key);
      revertingFiles = next;
    }
  }
</script>

{#snippet sidebarTop()}
  <!-- Reads the scope from the store, so a switch that fails leaves the
       toggle where it was. Spans the sidebar, each option taking half. -->
  <Segmented.Root
    bind:value={() => (isBranchScope ? 'branch' : 'working'), (v) => setScope(v as DiffScope)}
    disabled={switchingScope}
    aria-label="Diff scope"
    class="flex-1 min-w-0"
  >
    <Segmented.Item
      value="branch"
      class="flex-1 justify-center"
      title="Everything changed on this branch since it left the base branch, committed or not (like a pull request)"
    >Branch</Segmented.Item>
    <Segmented.Item
      value="working"
      class="flex-1 justify-center"
      title="Uncommitted changes in the working tree (staged, unstaged, untracked)"
    >Uncommitted</Segmented.Item>
  </Segmented.Root>
{/snippet}

{#snippet sidebarSummaryNote()}
  {#if isBranchScope && gitStatus.baseRef}
    <span class="truncate min-w-0" title="Compared against the merge base with {gitStatus.baseRef}">vs {gitStatus.baseRef}</span>
  {/if}
{/snippet}

{#snippet sidebarSummaryExtra()}
  <Button
    size="2xs"
    variant="subtle"
    onclick={() => gitOpsOpen = true}
    class="shrink-0"
    title="Rebase, squash, or cherry-pick between this branch and other threads' branches"
  >
    Branch…
  </Button>
{/snippet}

{#snippet commitBox()}
  {#if stagedEntries.length > 0}
    <div class="border-t border-border p-2 shrink-0 space-y-1.5">
      <div class="relative">
        <textarea
          bind:value={commitMessage}
          placeholder={generatingMsg ? 'Generating…' : 'Commit message…'}
          rows="2"
          onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCommit(); } }}
          class="w-full text-xs bg-background/50 border border-border/50 px-2 py-1 pr-6 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
        ></textarea>
        <Button
          size="icon-2xs"
          variant="quiet"
          onclick={generateMessage}
          disabled={generatingMsg || committing}
          class="absolute right-0.5 top-0.5 disabled:cursor-not-allowed"
          title="Generate a commit message from the staged changes"
          aria-label="Generate a commit message from the staged changes"
        >
          {#if generatingMsg}
            <Pulse motion="spin" tone="muted" size="sm" />
          {:else}
            <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l1.9 5.7a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-2a2 2 0 0 0 1.3-1.2L12 3z"/>
            </svg>
          {/if}
        </Button>
      </div>
      {#if commitError}
        <div class="text-micro text-destructive">{commitError}</div>
      {/if}
      <div class="flex gap-1.5">
        <Button
          size="xs"
          onclick={() => doCommit()}
          disabled={!commitMessage.trim() || committing}
          class="flex-1 disabled:cursor-not-allowed"
        >
          {committing && !pushing ? 'Committing…' : `Commit ${stagedEntries.length} file${stagedEntries.length !== 1 ? 's' : ''}`}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          onclick={() => doCommit(true)}
          disabled={!commitMessage.trim() || committing}
          class="disabled:cursor-not-allowed"
          title="Commit staged files, then push the branch to origin"
        >
          {pushing ? 'Pushing…' : '& Push'}
        </Button>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet prReviewBox()}
  {#if reviewablePr}
    {@const reviewPr = reviewablePr}
    <div class="border-t border-border p-2 shrink-0 space-y-1.5">
      {#if posted && posted.prNumber === reviewPr.number}
        {@const done = posted}
        <Notice tone="success" class="px-2 py-1.5">
          {#snippet actions()}
            <Button size="icon-2xs" variant="quiet" onclick={() => posted = null} aria-label="Dismiss" title="Dismiss">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </Button>
          {/snippet}
          <p>
            {POSTED_TEXT[done.event]} PR #{reviewPr.number}.
            {#if done.result.url}
              <Button size="inline" variant="external" onclick={() => window.groveBench.openExternal(done.result.url!)}>View</Button>
            {/if}
          </p>
          {#if done.result.inline + done.result.quoted > 0}
            <p class="text-micro text-muted-foreground">
              {done.result.inline} line comment{done.result.inline === 1 ? '' : 's'} on {done.result.inline === 1 ? 'its line' : 'their lines'}{#if done.result.quoted > 0}, {done.result.quoted} quoted in the summary{/if}
            </p>
          {/if}
        </Notice>
      {/if}
      <div class="flex items-center gap-1.5 text-micro text-muted-foreground min-w-0">
        <span class="shrink-0">PR #{reviewPr.number}</span>
        {#if reviewPr.title}<span class="truncate" title={reviewPr.title}>{reviewPr.title}</span>{/if}
        {#if reviewPr.reviewDecision === 'APPROVED'}
          <span class="ml-auto shrink-0 text-green-400">approved</span>
        {:else if reviewPr.reviewDecision === 'CHANGES_REQUESTED'}
          <span class="ml-auto shrink-0 text-amber-500" title="Changes requested">changes</span>
        {/if}
      </div>
      <Button
        size="xs"
        onclick={() => reviewOpen = true}
        class="w-full"
        title="Comment on, approve, or request changes on this PR on GitHub"
      >
        Review changes…
        {#if branchComments.length > 0}
          <span class="opacity-80">({branchComments.length} comment{branchComments.length === 1 ? '' : 's'})</span>
        {/if}
      </Button>
    </div>
  {/if}
{/snippet}

{#snippet sidebarFooter()}
  {@render commitBox()}
  {@render prReviewBox()}
{/snippet}

{#snippet reviewBarActions()}
  {#if reviewablePr && branchComments.length > 0}
    <Button size="2xs" variant="subtle" onclick={() => reviewOpen = true} title="Post these comments to PR #{reviewablePr.number} on GitHub, with a summary">
      Post to PR #{reviewablePr.number}…
    </Button>
  {/if}
{/snippet}

{#snippet headerActions(entry: GitStatusEntry)}
  <!-- A conflict can't be reverted (revertFile refuses it): it is resolved,
       then marked resolved, or the merge is aborted in the terminal. -->
  {#if !isBranchScope && entry.status !== 'conflicted'}
    {@const isUntracked = entry.status === 'untracked'}
    {@const reverting = revertingFiles.has(`${entry.filePath}:${entry.staged}`)}
    <Button
      size="xs"
      variant="outline-destructive"
      onclick={() => confirmEntry = entry}
      disabled={reverting}
      title={isUntracked ? 'Delete this untracked file' : 'Revert this file to its state before changes'}
    >
      {#if reverting}
        <!-- Pulse has no destructive tone: a plain square, as before. -->
        <span class="w-2 h-2 bg-destructive animate-pulse inline-block"></span>
      {:else}
        {isUntracked ? 'Discard' : 'Revert'}
      {/if}
    </Button>
    {#if revertError?.key === `${entry.filePath}:${entry.staged}`}
      <span role="alert" class="text-micro text-destructive min-w-0">{revertError.message}</span>
    {/if}
  {/if}
{/snippet}

{#snippet pathName(p: string)}<span class="font-mono text-xs break-all">{p}</span>{/snippet}

{#snippet dialogs()}
  <!-- Confirmation for destructive revert/discard -->
  <Dialog.Root open={confirmEntry !== null} onOpenChange={(v) => { if (!v) confirmEntry = null; }}>
    <Dialog.Content class="max-w-md">
      {#if confirmEntry}
        {@const isUntracked = confirmEntry.status === 'untracked'}
        <!-- Revert on a staged entry runs `git checkout HEAD`, which also
             drops edits not staged yet, and on a new file `git rm -f`, which
             deletes it: one staged as new or as a copy, or an unstaged add,
             which is a file added with `git add -N` (revertFile reads both
             the same way, and refuses a conflict). Say so, rather than "the
             changes shown here". -->
        {@const entryPath = confirmEntry.filePath}
        {@const isNewStaged = confirmEntry.staged && (confirmEntry.status === 'added' || confirmEntry.status === 'copied')}
        {@const isIntentToAdd = !confirmEntry.staged && confirmEntry.status === 'added'}
        {@const alsoUnstaged = confirmEntry.staged && gitStatus.entries.some((e) => !e.staged && e.filePath === entryPath)}
        <Dialog.Header>
          <Dialog.Title>{isUntracked || isNewStaged || isIntentToAdd ? 'Discard file?' : 'Revert file?'}</Dialog.Title>
          <Dialog.Description>
            {#if isUntracked}
              {@render pathName(confirmEntry.filePath)} will be permanently deleted from disk. This cannot be undone.
            {:else if confirmEntry.status === 'renamed' && confirmEntry.origPath}
              {@render pathName(confirmEntry.filePath)} was renamed from {@render pathName(confirmEntry.origPath)}. Reverting puts {@render pathName(confirmEntry.origPath)} back {confirmEntry.staged ? 'as last committed' : 'as staged'} and deletes {@render pathName(confirmEntry.filePath)}, with the changes shown here{alsoUnstaged ? ' and its unstaged edits' : ''}. This cannot be undone.
            {:else if isNewStaged}
              {@render pathName(confirmEntry.filePath)} is a new file, so reverting it deletes it from disk{alsoUnstaged ? ', including its unstaged edits' : ''}. This cannot be undone.
            {:else if isIntentToAdd}
              {@render pathName(confirmEntry.filePath)} was added with <span class="font-mono text-xs">git add -N</span>, so git has none of its content, and reverting it deletes it from disk. This cannot be undone.
            {:else if alsoUnstaged}
              {@render pathName(confirmEntry.filePath)} will be reset to its last committed state. That discards the staged changes shown here and its unstaged edits too.
            {:else}
              {@render pathName(confirmEntry.filePath)} will be reset to its last committed state, discarding the changes shown here.
            {/if}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Button variant="subtle" onclick={() => confirmEntry = null}>Cancel</Button>
          <Button variant="destructive" onclick={confirmRevert}>{isUntracked || isNewStaged || isIntentToAdd ? 'Discard' : 'Revert'}</Button>
        </Dialog.Footer>
      {/if}
    </Dialog.Content>
  </Dialog.Root>

  {#if gitOpsOpen}
    {#await loadGitOpsDialog() then GitOpsDialog}
      <GitOpsDialog {sessionId} onclose={() => gitOpsOpen = false} />
    {/await}
  {/if}

  {#if reviewOpen && reviewablePr}
    {@const reviewPr = reviewablePr}
    {#await loadPrReviewDialog() then PrReviewDialog}
      <PrReviewDialog
        {sessionId}
        pr={reviewPr}
        comments={branchComments}
        onclose={() => reviewOpen = false}
        onposted={(p) => onReviewPosted(reviewPr.number, p)}
      />
    {/await}
  {/if}
{/snippet}

<ReviewDiffPanel
  {sessionId}
  {sourceKey}
  entries={gitStatus.entries}
  active={sessionStore.activeSessionId === sessionId && messageStore.getActiveTab(sessionId) === 'changes'}
  loading={isLoading}
  changesLabel={isBranchScope ? 'Changed on branch' : 'Changes'}
  {loadDiff}
  {loadFileLines}
  onRefresh={() => gitStatusStore.refresh(sessionId)}
  onStage={isBranchScope ? undefined : stageEntry}
  onUnstage={isBranchScope ? undefined : unstageEntry}
  onStageAll={isBranchScope ? undefined : stageAll}
  onUnstageAll={isBranchScope ? undefined : unstageAll}
  {commentContext}
  {emptyTitle}
  emptyHint={isRunning ? 'Edits show up here as the agent makes them' : undefined}
  emptyScene="changes"
  panel="changesFiles"
  {sidebarTop}
  {sidebarSummaryExtra}
  {sidebarSummaryNote}
  {sidebarFooter}
  {reviewBarActions}
  {headerActions}
  {dialogs}
/>
