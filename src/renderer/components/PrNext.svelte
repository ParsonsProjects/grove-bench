<script lang="ts">
  /**
   * The branch popup's Next notice when the next step is a PR action the
   * app takes itself (lib/ship-track.ts): merge, mark ready for review,
   * turn auto-merge on or off, update the branch from its base, or tidy up
   * after a merge. Each runs gh in the project (pr-actions.ts in main), and
   * is offered only where GitHub says this account may (PrActionOptions).
   * Where it may not, or GitHub didn't answer, Next opens the PR on GitHub.
   *
   * A merge asks first, in this notice: what happens to the commits and the
   * branch. Where the PR waits on the base branch's rules and the account
   * may bypass them, Merge anyway asks in red, listing what it skips. Both
   * merge only the commit the confirm showed (GitHub refuses if the branch
   * moved since), and the confirm closes if new commits arrive while it's
   * open. On a base branch with a merge queue, the merge adds the PR to the
   * queue, which merges it later its own way.
   */
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { prStore, prActionError, updateBranchNote } from '../stores/pr.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { threadWorking } from '../lib/thread-working.js';
  import { MERGE_METHODS, type MergeMethod, type PrInfo } from '../../shared/types.js';
  import type { ShipNext } from '../lib/ship-track.js';
  import DropdownMenu, { type DropdownItem } from './DropdownMenu.svelte';

  let { sessionId, next, prInfo, onclose }: {
    sessionId: string;
    next: ShipNext;
    prInfo: PrInfo;
    /** Close the popup (Delete thread opens the sidebar's confirmation). */
    onclose: () => void;
  } = $props();

  let options = $derived(prStore.getActionOptions(sessionId));
  $effect(() => {
    // Asked again when the PR's state changes (actionKey).
    void prInfo;
    void prStore.loadActionOptions(sessionId);
  });

  let base = $derived(prInfo.baseRefName ?? 'the base branch');
  let chosenMethod = $state<MergeMethod | null>(null);
  let method = $derived(chosenMethod ?? prStore.mergeMethod(sessionId, options?.methods));
  let rebaseUpdate = $state(false);
  let deleteBranch = $state(true);
  /** Asking before a merge: a plain one, or one that bypasses the rules,
   *  of the head commit shown when it opened. */
  let confirm = $state<null | { admin: boolean; headSha: string }>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** What a finished action wants said (a branch kept, a copy not pulled). */
  let note = $state<string | null>(null);
  let working = $derived(threadWorking(sessionId));

  /** The base branch has a merge queue, and this merge goes through it (a
   *  bypass merges directly). */
  let queue = $derived(options?.mergeQueue === true);
  let queued = $derived(queue && !confirm?.admin);

  const LABEL: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Merge', rebase: 'Rebase and merge' };
  let methodDetail = $derived<Record<MergeMethod, string>>({
    squash: `One commit on ${base}`,
    merge: 'Keeps every commit, plus a merge commit',
    rebase: `Adds each commit to ${base} on its own`,
  });
  /** What the confirm says happens to the commits. */
  let mergeWords = $derived<Record<MergeMethod, string>>({
    squash: `Its commits become one on ${base}.`,
    merge: `Its commits join ${base} with a merge commit.`,
    rebase: `Its commits are added to ${base} one by one.`,
  });
  let mergeLabel = $derived(queued ? 'Add to merge queue' : LABEL[method]);

  /** The merge methods, those the repository turned off greyed. */
  function methodItems(onpick: (m: MergeMethod) => void, current: MergeMethod): DropdownItem[] {
    return MERGE_METHODS.map((m) => {
      const allowed = !options || options.methods.includes(m);
      return {
        label: LABEL[m],
        detail: allowed ? methodDetail[m] : 'Turned off for this repository',
        selected: m === current,
        disabled: !allowed,
        onclick: () => onpick(m),
      };
    });
  }

  /** The repository deletes merged branches itself: the box is ticked and
   *  can't be changed. Deleting is offered only where the account may, not
   *  while an open PR is based on the branch, and not through a merge queue
   *  (the PR merges later; a branch deleted now would close it). */
  let repoDeletes = $derived(options?.deleteBranchOnMerge === true);
  let canDelete = $derived(!queued && !repoDeletes && options?.canDeleteBranch !== false && (options?.stackedPrs ?? 0) === 0);
  let showDeleteBox = $derived(!queued && (repoDeletes || options?.canDeleteBranch !== false));

  /** Whether the next step's button can be offered here; otherwise Next
   *  opens the PR on GitHub. */
  let offered = $derived.by(() => {
    switch (next.action) {
      case 'merge': case 'mark-ready': case 'tidy': return true;
      case 'auto-merge': return options?.canEnableAutoMerge === true;
      case 'disable-auto-merge': return options?.canDisableAutoMerge !== false;
      case 'update-branch': return options?.canUpdateBranch !== false;
      default: return false;
    }
  });

  async function act(label: string, run: () => Promise<string | null | undefined | void>) {
    if (busy) return;
    busy = label;
    error = null;
    note = null;
    try {
      note = (await run()) ?? null;
      confirm = null;
    } catch (e) {
      error = prActionError(e, label);
    } finally {
      busy = null;
    }
  }

  function ask(admin: boolean) {
    error = null;
    note = null;
    if (!prInfo.headSha) {
      error = 'The PR\'s head commit isn\'t known yet. Try again in a moment.';
      return;
    }
    confirm = { admin, headSha: prInfo.headSha };
  }

  // The confirm is for what it showed. New commits close it (the merge
  // would be refused anyway); so does the merge no longer being the step.
  $effect(() => {
    const c = confirm;
    if (!c || busy) return;
    if (prInfo.headSha !== c.headSha) {
      confirm = null;
      note = 'New commits were pushed while this was open. Look at them, then merge again.';
    } else if (c.admin ? !bypassable : next.action !== 'merge') {
      confirm = null;
    }
  });

  function merge() {
    const c = confirm;
    if (!c) return;
    void act(c.admin ? 'Bypass and merge' : mergeLabel, async () => {
      const result = await prStore.mergePr(sessionId, { method, headSha: c.headSha, admin: c.admin, deleteBranch: canDelete && deleteBranch });
      return result.note;
    });
  }

  function updateBranch() {
    void act('Update branch', async () => updateBranchNote(await prStore.updateBranch(sessionId, rebaseUpdate)));
  }

  function deleteThread() {
    store.destroyRequest = sessionId;
    onclose();
  }

  let tone = $derived<'info' | 'success' | 'danger'>(confirm?.admin ? 'danger' : next.tone === 'wait' && !confirm ? 'info' : 'success');
  let title = $derived(
    confirm?.admin ? `Bypass ${base}'s rules and merge #${prInfo.number}?`
      : confirm && queued ? `Add #${prInfo.number} to ${base}'s merge queue?`
      : confirm ? `${LABEL[method]} #${prInfo.number} into ${base}?`
      : next.headline,
  );
  let bypassable = $derived(!!next.skips?.length && options?.canMergeAsAdmin === true);
  let shortSha = $derived((confirm?.headSha ?? prInfo.headSha)?.slice(0, 7) ?? '');
</script>

{#snippet deleteBox()}
  {#if showDeleteBox}
    <label class="flex items-center gap-2 text-foreground" title={repoDeletes ? 'This repository deletes merged branches itself' : (options?.stackedPrs ?? 0) > 0 ? 'Kept: an open PR is based on this branch' : 'Delete it on GitHub. The thread keeps its own copy.'}>
      <Checkbox checked={repoDeletes || (canDelete && deleteBranch)} disabled={!canDelete} onCheckedChange={(v) => (deleteBranch = v === true)} />
      Delete the branch after merging
    </label>
  {/if}
{/snippet}

{#snippet actions()}
  {#if confirm}
    <Button
      size="xs"
      variant={confirm.admin ? 'outline-destructive' : 'default'}
      disabled={!!busy}
      onclick={merge}
    >{busy ?? (confirm.admin ? 'Bypass and merge' : mergeLabel)}</Button>
    <Button size="xs" variant="subtle" disabled={!!busy} onclick={() => { confirm = null; error = null; }}>Cancel</Button>
  {:else if !offered}
    <Button size="xs" variant="external" onclick={() => window.groveBench.openExternal(prInfo.url)}>Open on GitHub<ExternalLink class="size-3" /></Button>
  {:else if next.action === 'merge'}
    <div class="flex items-center">
      <Button size="xs" disabled={!!busy} onclick={() => ask(false)}>{mergeLabel}</Button>
      {#if !queued}
        <DropdownMenu
          label="Choose how to merge"
          items={methodItems((m) => (chosenMethod = m), method)}
          disabled={!!busy}
          variant="default"
          size="icon-xs"
          class="border-l border-primary-foreground/30"
        ><ChevronDown /></DropdownMenu>
      {/if}
    </div>
  {:else if next.action === 'mark-ready'}
    <Button size="xs" disabled={!!busy} onclick={() => act('Mark ready', () => prStore.setDraft(sessionId, false))}>{busy ?? 'Mark ready for review'}</Button>
  {:else if next.action === 'auto-merge'}
    <div class="flex items-center">
      <Button size="xs" variant="subtle-primary" disabled={!!busy} onclick={() => act('Turn on auto-merge', () => prStore.setAutoMerge(sessionId, true, method))}>
        {busy === 'Turn on auto-merge' ? 'Turning on…'
          : queue ? 'Add to the queue when ready'
          : `Turn on auto-merge (${method === 'merge' ? 'merge commit' : method})`}
      </Button>
      {#if !queue}
        <DropdownMenu
          label="Choose how it merges"
          items={methodItems((m) => (chosenMethod = m), method)}
          disabled={!!busy}
          variant="subtle-primary"
          size="icon-xs"
          class="border-l-0"
        ><ChevronDown /></DropdownMenu>
      {/if}
    </div>
  {:else if next.action === 'disable-auto-merge'}
    <Button size="xs" variant="subtle" disabled={!!busy} onclick={() => act('Turn off auto-merge', () => prStore.setAutoMerge(sessionId, false))}>{busy ? 'Turning off…' : 'Turn off'}</Button>
  {:else if next.action === 'update-branch'}
    <div class="flex items-center">
      <Button size="xs" disabled={!!busy} onclick={updateBranch} title={rebaseUpdate ? `Rebase the branch onto ${base} on GitHub` : `Merge ${base} into the branch on GitHub`}>
        {busy ? 'Updating…' : 'Update branch'}
      </Button>
      <DropdownMenu
        label="Choose how to update"
        items={[
          { label: `Merge ${base} in`, detail: 'Adds a merge commit', selected: !rebaseUpdate, onclick: () => (rebaseUpdate = false) },
          { label: `Rebase onto ${base}`, detail: 'Rewrites the branch\'s commits', selected: rebaseUpdate, onclick: () => (rebaseUpdate = true) },
        ]}
        disabled={!!busy}
        variant="default"
        size="icon-xs"
        class="border-l border-primary-foreground/30"
      ><ChevronDown /></DropdownMenu>
    </div>
  {:else if next.action === 'tidy'}
    <Button size="xs" variant="subtle-primary" onclick={deleteThread} title="Delete this thread and its worktree. It asks first, and says if anything isn't saved.">Delete thread…</Button>
    {#if options?.canDeleteBranch && options.stackedPrs === 0 && !prStore.branchDeleted(sessionId)}
      <Button size="xs" variant="subtle" disabled={!!busy} onclick={() => act('Delete branch', async () => (await prStore.deletePrBranch(sessionId)).note)}
        title="Delete {prInfo.headRefName ?? 'the branch'} on GitHub, if nothing else needs it">{busy ?? 'Delete branch'}</Button>
    {/if}
  {/if}
{/snippet}

<Notice {tone} {title} layout="stacked" {actions} data-testid="next">
  {#if confirm?.admin}
    <p>This skips what {base} requires:</p>
    <ul class="list-disc pl-4">
      {#each next.skips ?? [] as skip (skip)}<li>{skip}</li>{/each}
    </ul>
    <p>GitHub records that you bypassed them. It {method === 'squash' ? 'squashes and merges' : method === 'rebase' ? 'rebases and merges' : 'merges'} only the commit you've seen{shortSha ? ` (${shortSha})` : ''}: if anyone pushes meanwhile, GitHub refuses.</p>
    {@render deleteBox()}
  {:else if confirm && queued}
    <p>GitHub merges it when its turn comes, the way the queue is set up, as long as the branch is still at {shortSha}.</p>
  {:else if confirm}
    <p>{mergeWords[method]}{canDelete && deleteBranch ? ' The branch is deleted on GitHub after, if nothing else needs it, and the thread keeps its copy.' : ''} This can't be undone from here.</p>
  {:else}
    {#if next.detail}<p>{next.detail}</p>{/if}
    {#if next.action === 'merge' && offered}{@render deleteBox()}{/if}
    {#if next.action === 'update-branch' && offered}
      <p class="text-caption text-muted-foreground">{working ? 'An agent is working in the thread, so its copy is left until you pull it.' : 'The thread\'s copy is updated after, so the agent works on it.'}</p>
    {/if}
    {#if bypassable}
      <div class="mt-1 flex items-center gap-2 border-t border-border pt-2">
        <span class="flex-1 text-caption text-muted-foreground">You can bypass {base}'s rules{queue ? ' and its merge queue' : ''}.</span>
        <Button size="2xs" variant="subtle" class="text-amber-500" disabled={!!busy} onclick={() => ask(true)} title="Merge now, without what {base} requires">
          <ShieldIcon />Merge anyway…
        </Button>
      </div>
    {/if}
  {/if}
  {#if error}<p class="text-red-400" role="alert">{error}</p>{/if}
  {#if note}<p class="text-muted-foreground" role="status">{note}</p>{/if}
</Notice>
