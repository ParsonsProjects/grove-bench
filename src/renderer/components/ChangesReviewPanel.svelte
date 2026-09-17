<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import type { GitStatusEntry, DiffScope } from '../../shared/types.js';
  import ReviewDiffPanel from './ReviewDiffPanel.svelte';
  import GitOpsDialog from './GitOpsDialog.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  /**
   * The Changes tab: git status (uncommitted working tree, or the whole
   * branch since its base) fed into the shared review panel, plus the git
   * client actions that only make sense here — stage/unstage, revert, commit,
   * branch operations.
   */
  let { sessionId }: { sessionId: string } = $props();

  /** Rebase / squash / cherry-pick dialog (branch operations between agent branches). */
  let gitOpsOpen = $state(false);

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
      commitMessage = await window.groveBench.generateCommitMessage(sessionId);
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
      commitError = e?.message || (committed ? 'Push failed' : 'Commit failed');
    } finally {
      committing = false;
      pushing = false;
    }
  }

  // ── Revert / discard (destructive, confirmed first) ──
  let confirmEntry = $state<GitStatusEntry | null>(null);
  let revertingFiles = $state<Set<string>>(new Set());

  function confirmRevert() {
    const entry = confirmEntry;
    confirmEntry = null;
    if (entry) revertFile(entry);
  }

  async function revertFile(entry: GitStatusEntry) {
    const key = `${entry.filePath}:${entry.staged}`;
    revertingFiles = new Set([...revertingFiles, key]);
    try {
      await gitStatusStore.revertFile(sessionId, entry.filePath, entry.staged);
    } catch (e) {
      console.error('Failed to revert file:', e);
    } finally {
      const next = new Set(revertingFiles);
      next.delete(key);
      revertingFiles = next;
    }
  }
</script>

{#snippet scopeToggle()}
  <div class="inline-flex border border-border/60 text-[10px]" role="group" aria-label="Diff scope">
    <button
      onclick={() => setScope('working')}
      disabled={switchingScope}
      class="px-2 py-0.5 transition-colors {!isBranchScope ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
      title="Uncommitted changes in the working tree (staged, unstaged, untracked)"
    >Uncommitted</button>
    <button
      onclick={() => setScope('branch')}
      disabled={switchingScope}
      class="px-2 py-0.5 border-l border-border/60 transition-colors {isBranchScope ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
      title="Everything changed on this branch since it left the base branch, committed or not (like a pull request)"
    >Branch</button>
  </div>
{/snippet}

{#snippet sidebarTop()}
  {@render scopeToggle()}
  {#if isBranchScope && gitStatus.baseRef}
    <span class="text-[10px] text-muted-foreground truncate" title="Compared against the merge base with {gitStatus.baseRef}">vs {gitStatus.baseRef}</span>
  {/if}
{/snippet}

{#snippet sidebarSummaryExtra()}
  <button
    onclick={() => gitOpsOpen = true}
    class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors shrink-0"
    title="Rebase, squash, or cherry-pick between this branch and other sessions' branches"
  >
    Branch…
  </button>
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
          class="w-full text-xs bg-background/50 border border-border/50 px-2 py-1 pr-6 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none"
        ></textarea>
        <button
          onclick={generateMessage}
          disabled={generatingMsg || committing}
          class="absolute right-1 top-1 p-0.5 text-muted-foreground/60 hover:text-primary disabled:cursor-not-allowed transition-colors"
          title="Generate a commit message from the staged changes"
        >
          {#if generatingMsg}
            <span class="block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
          {:else}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l1.9 5.7a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-2a2 2 0 0 0 1.3-1.2L12 3z"/>
            </svg>
          {/if}
        </button>
      </div>
      {#if commitError}
        <div class="text-[10px] text-destructive">{commitError}</div>
      {/if}
      <div class="flex gap-1.5">
        <button
          onclick={() => doCommit()}
          disabled={!commitMessage.trim() || committing}
          class="flex-1 text-xs px-2 py-1 bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {committing && !pushing ? 'Committing…' : `Commit ${stagedEntries.length} file${stagedEntries.length !== 1 ? 's' : ''}`}
        </button>
        <button
          onclick={() => doCommit(true)}
          disabled={!commitMessage.trim() || committing}
          class="text-xs px-2 py-1 border border-border text-foreground/80 hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Commit staged files, then push the branch to origin"
        >
          {pushing ? 'Pushing…' : '& Push'}
        </button>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet headerActions(entry: GitStatusEntry)}
  {#if !isBranchScope}
    {@const isUntracked = entry.status === 'untracked'}
    {@const reverting = revertingFiles.has(`${entry.filePath}:${entry.staged}`)}
    <button
      onclick={() => confirmEntry = entry}
      disabled={reverting}
      class="text-xs px-2 py-0.5 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
      title={isUntracked ? 'Delete this untracked file' : 'Revert this file to its state before changes'}
    >
      {#if reverting}
        <span class="w-2 h-2 bg-destructive animate-pulse inline-block"></span>
      {:else}
        {isUntracked ? 'Discard' : 'Revert'}
      {/if}
    </button>
  {/if}
{/snippet}

{#snippet dialogs()}
  <!-- Confirmation for destructive revert/discard -->
  <Dialog.Root open={confirmEntry !== null} onOpenChange={(v) => { if (!v) confirmEntry = null; }}>
    <Dialog.Content class="max-w-md">
      {#if confirmEntry}
        {@const isUntracked = confirmEntry.status === 'untracked'}
        <Dialog.Header>
          <Dialog.Title>{isUntracked ? 'Discard file?' : 'Revert file?'}</Dialog.Title>
          <Dialog.Description>
            {#if isUntracked}
              <span class="font-mono text-xs break-all">{confirmEntry.filePath}</span> will be permanently deleted from disk. This cannot be undone.
            {:else}
              <span class="font-mono text-xs break-all">{confirmEntry.filePath}</span> will be reset to its last committed state, discarding the changes shown here.
            {/if}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Button variant="outline" onclick={() => confirmEntry = null}>Cancel</Button>
          <Button variant="destructive" onclick={confirmRevert}>{isUntracked ? 'Discard' : 'Revert'}</Button>
        </Dialog.Footer>
      {/if}
    </Dialog.Content>
  </Dialog.Root>

  {#if gitOpsOpen}
    <GitOpsDialog {sessionId} onclose={() => gitOpsOpen = false} />
  {/if}
{/snippet}

<ReviewDiffPanel
  {sessionId}
  {sourceKey}
  entries={gitStatus.entries}
  loading={isLoading}
  changesLabel={isBranchScope ? 'Changed on branch' : 'Changes'}
  {loadDiff}
  {loadFileLines}
  onRefresh={() => gitStatusStore.refresh(sessionId)}
  onStage={isBranchScope ? undefined : stageEntry}
  onUnstage={isBranchScope ? undefined : unstageEntry}
  onStageAll={isBranchScope ? undefined : stageAll}
  onUnstageAll={isBranchScope ? undefined : unstageAll}
  commentContext={isBranchScope ? `branch vs ${gitStatus.baseRef ?? scopeState.base ?? 'base'}` : undefined}
  {emptyTitle}
  emptyHint={isRunning ? 'Edits show up here as the agent makes them' : undefined}
  emptyExtra={scopeToggle}
  {sidebarTop}
  {sidebarSummaryExtra}
  sidebarFooter={commitBox}
  {headerActions}
  {dialogs}
/>
