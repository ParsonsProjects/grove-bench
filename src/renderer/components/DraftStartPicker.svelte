<script lang="ts">
  /**
   * Where a draft conversation will run: a new branch (optionally named, from
   * a base), an existing branch or open PR, or the project folder itself.
   * Opened from the branch area of the draft's status bar. Choices apply as
   * they're made; a click outside or Escape closes it (DraftStatusBar).
   */
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore, type DraftStart } from '../stores/draft.svelte.js';
  import type { OpenPrSummary } from '../../shared/types.js';

  let { onclose }: { onclose: () => void } = $props();

  const draft = $derived(draftStore.draft);
  const repoPath = $derived(draft?.repoPath ?? '');
  const start = $derived(draft?.start);

  type Tab = DraftStart['kind'];
  let tab = $state<Tab>(draftStore.draft?.start.kind ?? 'new');
  /** A project that isn't a git repository can only run in its folder. */
  const folderProject = $derived(store.isFolderProject(repoPath));
  const TABS: [Tab, string][] = [['new', 'New branch'], ['existing', 'Branch or PR'], ['folder', 'Project folder']];
  const tabs = $derived(folderProject ? TABS.filter(([value]) => value === 'folder') : TABS);

  let branches = $state<string[]>([]);
  let loadingBranches = $state(true);
  let prs = $state<OpenPrSummary[]>([]);
  let loadingPrs = $state(true);
  let prsError = $state('');
  let search = $state('');
  let searchEl = $state<HTMLInputElement | null>(null);

  onMount(() => {
    const repo = repoPath;
    if (!repo || store.isFolderProject(repo)) return;
    // Local refs first so the list shows at once, then again after a fetch.
    window.groveBench.listBranches(repo, { fetch: false })
      .then((list) => { if (repo === repoPath) branches = list; })
      .catch(() => {})
      .finally(() => {
        loadingBranches = false;
        window.groveBench.listBranches(repo).then((list) => { if (repo === repoPath) branches = list; }).catch(() => {});
      });
    window.groveBench.listOpenPrs(repo)
      .then((list) => { if (repo === repoPath) prs = list; })
      .catch(() => { prsError = 'Pull requests could not be listed. Check that the GitHub CLI is installed and signed in.'; })
      .finally(() => { loadingPrs = false; });
  });

  $effect(() => {
    if (tab === 'existing') searchEl?.focus();
  });

  /** Branches another conversation in this project has checked out. Git
   *  allows a branch in only one worktree at a time. */
  const usedBranches = $derived(new Set(
    store.sessions.filter((s) => s.repoPath === repoPath).map((s) => s.branch),
  ));

  function looseMatch(text: string, query: string): boolean {
    const lower = text.toLowerCase();
    return query.split(/\s+/).every((token) => lower.includes(token));
  }

  // Fork PRs have no branch in this repo to check out, so they aren't listed.
  const reviewablePrs = $derived(prs.filter((p) => !p.isCrossRepository && !usedBranches.has(p.headRefName)));
  const forkPrCount = $derived(prs.filter((p) => p.isCrossRepository).length);
  const plainBranches = $derived.by(() => {
    const prHeads = new Set(reviewablePrs.map((p) => p.headRefName));
    return branches.filter((b) => !usedBranches.has(b) && !prHeads.has(b));
  });
  const query = $derived(search.toLowerCase().trim());
  const filteredPrs = $derived(query
    ? reviewablePrs.filter((p) => looseMatch(`#${p.number} ${p.title} ${p.headRefName} ${p.author}`, query))
    : reviewablePrs);
  const filteredBranches = $derived(query ? plainBranches.filter((b) => looseMatch(b, query)) : plainBranches);

  // New branch fields edit the draft directly while that tab is chosen.
  const newStart = $derived(start?.kind === 'new' ? start : null);
  let baseListOpen = $state(false);
  const baseMatches = $derived.by(() => {
    const q = (newStart?.baseBranch ?? '').toLowerCase().trim();
    const list = q ? branches.filter((b) => looseMatch(b, q)) : branches;
    return list.slice(0, 50);
  });

  function chooseTab(next: Tab) {
    tab = next;
    if (next === 'new' && start?.kind !== 'new') {
      draftStore.resetToNewBranch();
    } else if (next === 'folder') {
      draftStore.setStart({ kind: 'folder' });
    }
  }

  function setNew(patch: Partial<{ branchName: string; baseBranch: string }>) {
    if (!newStart) return;
    draftStore.setStart({ ...newStart, ...patch });
  }

  function pickPr(pr: OpenPrSummary) {
    draftStore.setStart({ kind: 'existing', branch: pr.headRefName, pr: { number: pr.number, title: pr.title } });
    onclose();
  }

  function pickBranch(name: string) {
    draftStore.setStart({ kind: 'existing', branch: name });
    onclose();
  }

  const isPr = (pr: OpenPrSummary) => start?.kind === 'existing' && start.pr?.number === pr.number;
  const isBranch = (name: string) => start?.kind === 'existing' && !start.pr && start.branch === name;
</script>

<div class="w-96 bg-popover border border-border shadow-xl text-xs" role="dialog" aria-label="Where this thread runs">
  <div class="flex border-b border-border" role="group" aria-label="Where it runs">
    {#each tabs as [value, label] (value)}
      <button
        type="button"
        onclick={() => chooseTab(value as Tab)}
        aria-pressed={tab === value}
        class="flex-1 px-3 py-2 border-b-2 transition-colors {tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        {label}
      </button>
    {/each}
  </div>

  <div class="p-3">
    {#if tab === 'new'}
      <p class="text-muted-foreground mb-3">
        A separate copy of the project on a new branch, so this thread's changes stay away from your other work.
      </p>
      <label class="block mb-1 text-muted-foreground" for="draft-branch-name">Branch name</label>
      <input
        id="draft-branch-name"
        type="text"
        value={newStart?.branchName ?? ''}
        oninput={(e) => setNew({ branchName: e.currentTarget.value })}
        placeholder="Named from your first message"
        class="w-full bg-background border border-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <label class="block mt-3 mb-1 text-muted-foreground" for="draft-base">Base branch</label>
      <div class="relative">
        <input
          id="draft-base"
          type="text"
          value={newStart?.baseBranch ?? ''}
          oninput={(e) => { setNew({ baseBranch: e.currentTarget.value }); baseListOpen = true; }}
          onfocus={() => baseListOpen = true}
          onblur={() => setTimeout(() => baseListOpen = false, 150)}
          placeholder="branch, tag, or commit hash"
          class="w-full bg-background border border-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {#if baseListOpen && baseMatches.length > 0}
          <div class="absolute z-10 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-popover border border-border shadow-md p-1">
            {#each baseMatches as b (b)}
              <button
                type="button"
                class="w-full text-left px-2 py-1 hover:bg-accent truncate {b === newStart?.baseBranch ? 'bg-accent' : ''}"
                onmousedown={(e) => { e.preventDefault(); setNew({ baseBranch: b }); baseListOpen = false; }}
              >
                {b}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if tab === 'existing'}
      <input
        bind:this={searchEl}
        bind:value={search}
        type="text"
        placeholder="Search by number, title, branch or author"
        aria-label="Search pull requests and branches"
        class="w-full bg-background border border-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div class="mt-2 max-h-64 overflow-y-auto -mx-1">
        {#if (loadingPrs || loadingBranches) && filteredPrs.length === 0 && filteredBranches.length === 0}
          <div class="px-2 py-4 text-muted-foreground text-center">Loading…</div>
        {:else if filteredPrs.length === 0 && filteredBranches.length === 0}
          <div class="px-2 py-4 text-muted-foreground text-center">{query ? 'Nothing matches' : 'No branches available'}</div>
        {:else}
          {#if filteredPrs.length > 0}
            <div class="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">Open pull requests</div>
            {#each filteredPrs as pr (pr.number)}
              <button
                type="button"
                onclick={() => pickPr(pr)}
                aria-pressed={isPr(pr)}
                class="w-full text-left px-2 py-1.5 hover:bg-accent flex flex-col {isPr(pr) ? 'bg-accent' : ''}"
              >
                <span class="truncate text-foreground"><span class="text-muted-foreground">#{pr.number}</span> {pr.title}</span>
                <span class="truncate text-[11px] text-muted-foreground">{pr.headRefName}{pr.author ? ` · ${pr.author}` : ''}{pr.isDraft ? ' · draft' : ''}</span>
              </button>
            {/each}
          {/if}
          {#if filteredBranches.length > 0}
            <div class="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">Branches</div>
            {#each filteredBranches as name (name)}
              <button
                type="button"
                onclick={() => pickBranch(name)}
                aria-pressed={isBranch(name)}
                class="w-full text-left px-2 py-1 hover:bg-accent truncate {isBranch(name) ? 'bg-accent text-foreground' : 'text-muted-foreground'}"
              >
                {name}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
      {#if prsError}
        <p class="text-muted-foreground mt-2">{prsError}</p>
      {/if}
      {#if forkPrCount > 0}
        <p class="text-muted-foreground mt-2">
          {forkPrCount === 1 ? '1 pull request from a fork is' : `${forkPrCount} pull requests from forks are`} not listed yet.
        </p>
      {/if}
    {:else if folderProject}
      <p class="text-muted-foreground">
        This project is used without git, so threads run in the folder itself. The agent edits your files in place, and its edits can't be rewound.
      </p>
      <p class="text-muted-foreground/70 mt-2">
        For a separate copy per thread and undo, run <code class="text-foreground">git init</code> in the folder, commit its files, then remove and add the project again.
      </p>
    {:else}
      <p class="text-muted-foreground">
        Runs in the project folder itself, on whatever branch it has checked out. No separate copy is made, so the agent's changes land in your checkout and your editor sees them straight away.
      </p>
    {/if}
  </div>
</div>
