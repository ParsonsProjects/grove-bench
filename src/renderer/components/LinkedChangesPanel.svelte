<script lang="ts">
  import { untrack } from 'svelte';
  import type { DiffScope, GitStatusEntry, GitStatusResult } from '../../shared/types.js';
  import ReviewDiffPanel from './ReviewDiffPanel.svelte';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import { linkedStore } from '../stores/linked.svelte.js';
  import { linkedReviewKey } from '../stores/review.svelte.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { errorMessage } from '../../shared/error-message.js';

  /**
   * The Changes tab's view of one of the thread's linked projects
   * (docs/linked-projects-plan.md): its worktree's changes, the whole branch
   * since its base or what isn't committed yet, read only. Staging,
   * reverting, committing and PR reviews stay with the thread's own
   * project. Line comments still go to the thread's agent, and say which
   * project and worktree they are about. Read when shown, when the scope
   * changes, every few seconds while the agent works, at the end of each
   * turn and when the window comes back into focus.
   */
  let { sessionId, repoPath, active }: { sessionId: string; repoPath: string; active: boolean } = $props();

  /** How often the files are read again while the agent works. */
  const WHILE_WORKING_MS = 5_000;

  let scope = $state<DiffScope>('branch');
  /** The branch scope's base: the linked branch's PR's base, else the
   *  Default base branch setting, else the project's default branch
   *  (resolveBaseBranch). */
  let base = $state<string | null>(null);
  let status = $state<GitStatusResult | null>(null);
  let loading = $state(false);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let link = $derived(linkedStore.get(sessionId).find((l) => l.repoPath === repoPath));
  let name = $derived(sessionStore.repoDisplayName(repoPath));
  let isBranchScope = $derived(scope === 'branch');

  /** Bumped per read, so an older answer can't replace a newer one. */
  let generation = 0;
  async function refresh() {
    const mine = ++generation;
    loading = true;
    try {
      let b = base;
      if (scope === 'branch' && !b) {
        b = link?.pr?.baseRefName || await resolveBaseBranch(repoPath);
        if (mine === generation) base = b;
      }
      const result = await window.groveBench.getGitStatus(sessionId, {
        scope,
        ...(scope === 'branch' && b ? { base: b } : {}),
        linkedRepo: repoPath,
      });
      if (mine === generation) status = result;
    } catch (e) {
      // Skipped or failed: what was shown stays, if anything was.
      if (mine === generation && !status) status = { entries: [], error: errorMessage(e, "Couldn't read the changes") };
    } finally {
      if (mine === generation) loading = false;
    }
  }

  // The branch's PR, known only once the status is read (often after the
  // first read here): its base is what the comparison should be against.
  $effect(() => {
    const prBase = link?.pr?.baseRefName;
    if (!prBase || prBase === untrack(() => base)) return;
    untrack(() => {
      base = prBase;
      if (scope === 'branch' && active) {
        status = null;
        void refresh();
      }
    });
  });

  // Read when shown, and again for another scope.
  $effect(() => {
    void scope;
    if (active) untrack(() => void refresh());
  });

  // A turn may have changed, committed or pushed files there.
  let prevRunning = false;
  $effect(() => {
    const running = isRunning;
    if (prevRunning && !running && active) untrack(() => void refresh());
    prevRunning = running;
  });

  $effect(() => {
    if (!active || !isRunning) return;
    const timer = setInterval(() => void refresh(), WHILE_WORKING_MS);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!active) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });

  function setScope(next: DiffScope) {
    if (next === scope) return;
    status = null;
    scope = next;
  }

  let sourceKey = $derived(`linked:${repoPath}:${isBranchScope ? `branch:${base ?? ''}` : 'working'}`);
  /** Said with each line comment the agent gets: the files are another
   *  project's, in the worktree the thread has of it (the prompt says
   *  where). Not the path, which arrives with the status after the first
   *  read: a comment written before it would then stop showing. */
  let where = $derived(`in ${name}, in this thread's worktree of it`);
  let commentContext = $derived(isBranchScope ? `${where}, branch vs ${base ?? status?.baseRef ?? 'base'}` : `${where}, uncommitted`);
  let emptyTitle = $derived(
    !status
      ? 'Loading changes…'
      : status.error !== undefined
        ? "Couldn't read the changes"
        : isBranchScope
          ? (status.scopeError ?? `No changes in ${name} vs ${status.baseRef ?? base ?? 'base'}`)
          : `No uncommitted changes in ${name}`,
  );

  function loadDiff(entry: GitStatusEntry) {
    return window.groveBench.getFileDiff(sessionId, entry.filePath, entry.staged, {
      ...(isBranchScope && base ? { base } : {}),
      linkedRepo: repoPath,
    });
  }
  function loadFileLines(entry: GitStatusEntry) {
    return window.groveBench.getFileLines(sessionId, entry.filePath, entry.staged, { linkedRepo: repoPath });
  }
</script>

{#snippet sidebarTop()}
  <Segmented.Root
    bind:value={() => scope, (v) => setScope(v as DiffScope)}
    aria-label="Diff scope"
    class="flex-1 min-w-0"
  >
    <Segmented.Item
      value="branch"
      class="flex-1 justify-center"
      title="Everything changed on the branch in {name} since it left its base branch, committed or not"
    >Branch</Segmented.Item>
    <Segmented.Item
      value="working"
      class="flex-1 justify-center"
      title="Changes in {name} not committed yet (staged, unstaged, untracked)"
    >Uncommitted</Segmented.Item>
  </Segmented.Root>
{/snippet}

{#snippet sidebarSummaryNote()}
  {#if isBranchScope && status?.baseRef}
    <span class="truncate min-w-0" title="Compared against the merge base with {status.baseRef}">vs {status.baseRef}</span>
  {/if}
{/snippet}

{#snippet sidebarFooter()}
  <!-- Clear of the grove the status bar's top border carries (16px). -->
  <p class="border-t border-border px-2 pt-2 pb-5 shrink-0 text-micro text-muted-foreground" data-testid="linked-changes-note">
    Read only. Commit, push and open pull requests in {name} yourself, or ask the agent.
  </p>
{/snippet}

<ReviewDiffPanel
  {sessionId}
  {sourceKey}
  entries={status?.entries ?? []}
  {active}
  {loading}
  changesLabel={isBranchScope ? 'Changed on branch' : 'Changes'}
  {loadDiff}
  {loadFileLines}
  onRefresh={() => void refresh()}
  {commentContext}
  {emptyTitle}
  emptyHint={isRunning && status && status.error === undefined ? `Edits in ${name} show up here as the agent makes them` : undefined}
  emptyError={status?.error}
  emptyScene="changes"
  panel="changesFiles"
  reviewKey={linkedReviewKey(sessionId, repoPath)}
  linkedRepo={repoPath}
  {sidebarTop}
  {sidebarSummaryNote}
  {sidebarFooter}
/>
