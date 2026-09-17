<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { checkpointStore } from '../stores/checkpoints.svelte.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { candidateBranches, squashMessageFrom, describeOpResult, type BranchCandidate } from '../lib/git-ops.js';
  import type { CommitEntry } from '../../shared/types.js';

  export type GitOpMode = 'rebase' | 'squash' | 'cherry-pick';

  let { sessionId, onclose, initialMode = 'rebase' }: { sessionId: string; onclose: () => void; initialMode?: GitOpMode } = $props();

  let open = $state(true);
  // The prop only seeds the tab; switching tabs afterwards is local state.
  let mode = $state<GitOpMode>(untrack(() => initialMode));
  let baseBranch = $state('');
  let candidates = $state<BranchCandidate[]>([]);
  let busy = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  // Rebase
  let rebaseOnto = $state('');

  // Squash
  let squashBase = $state('');
  let squashCommits = $state<CommitEntry[]>([]);
  let squashMessage = $state('');
  let squashLoading = $state(false);

  // Cherry-pick
  let pickSource = $state('');
  let pickCommits = $state<CommitEntry[]>([]);
  let pickSha = $state('');
  let pickLoading = $state(false);

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let sessionBranch = $derived(session?.branch ?? '');

  const MODES: { id: GitOpMode; label: string }[] = [
    { id: 'rebase', label: 'Rebase' },
    { id: 'squash', label: 'Squash' },
    { id: 'cherry-pick', label: 'Cherry-pick' },
  ];

  onMount(async () => {
    baseBranch = await resolveBaseBranch(session?.repoPath ?? '');
    candidates = candidateBranches(store.sessions, sessionId, baseBranch);
    rebaseOnto = candidates[0]?.branch ?? baseBranch;
    squashBase = baseBranch;
    pickSource = candidates.find((c) => c.sessionId)?.branch ?? '';
  });

  // Squash preview: the commits that would be folded together
  $effect(() => {
    const base = squashBase.trim();
    if (mode !== 'squash' || !base) { squashCommits = []; return; }
    squashLoading = true;
    window.groveBench.gitLogCommits(sessionId, 'HEAD', base)
      .then((commits) => {
        squashCommits = commits;
        if (!squashMessage.trim()) squashMessage = squashMessageFrom(commits);
      })
      .catch(() => { squashCommits = []; })
      .finally(() => { squashLoading = false; });
  });

  // Cherry-pick: commits on the source branch that this branch doesn't have
  $effect(() => {
    const source = pickSource.trim();
    if (mode !== 'cherry-pick' || !source) { pickCommits = []; return; }
    pickLoading = true;
    window.groveBench.gitLogCommits(sessionId, source, 'HEAD')
      .then((commits) => { pickCommits = commits; pickSha = commits[0]?.sha ?? ''; })
      .catch(() => { pickCommits = []; })
      .finally(() => { pickLoading = false; });
  });

  function afterChange() {
    gitStatusStore.refresh(sessionId);
    prStore.refresh(sessionId, true).catch(() => {});
    checkpointStore.scheduleRefresh(sessionId);
  }

  async function run() {
    if (busy) return;
    busy = true;
    result = null;
    try {
      if (mode === 'rebase') {
        const r = await window.groveBench.gitRebase(sessionId, rebaseOnto.trim());
        result = describeOpResult(r, 'Rebase');
      } else if (mode === 'squash') {
        const r = await window.groveBench.gitSquash(sessionId, squashBase.trim(), squashMessage);
        result = describeOpResult(r, 'Squash');
        if (r.success) { squashCommits = []; squashMessage = ''; }
      } else {
        const r = await window.groveBench.gitCherryPick(sessionId, pickSha);
        result = describeOpResult(r, 'Cherry-pick');
        if (r.success) pickCommits = pickCommits.filter((c) => c.sha !== pickSha);
      }
      if (result.ok) afterChange();
    } catch (e: any) {
      result = { ok: false, text: e?.message || String(e) };
    } finally {
      busy = false;
    }
  }

  let canRun = $derived.by(() => {
    if (busy) return false;
    if (mode === 'rebase') return !!rebaseOnto.trim();
    if (mode === 'squash') return !!squashBase.trim() && !!squashMessage.trim() && squashCommits.length >= 2;
    return !!pickSha;
  });

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      open = false;
      onclose();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Branch operations</Dialog.Title>
      <Dialog.Description>
        Rewrite <span class="font-mono text-foreground">{sessionBranch}</span> against another branch. A conflicting
        operation is aborted and the branch left as it was.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex border-b border-border mt-3">
      {#each MODES as m (m.id)}
        <button
          onclick={() => { mode = m.id; result = null; }}
          class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px
            {mode === m.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          {m.label}
        </button>
      {/each}
    </div>

    <div class="flex flex-col gap-3 mt-3">
      {#if mode === 'rebase'}
        <div>
          <Label for="gitops-onto" class="mb-1 block">Rebase onto</Label>
          <Input id="gitops-onto" type="text" bind:value={rebaseOnto} placeholder={baseBranch || 'main'} list="gitops-branches" />
          <p class="text-[10px] text-muted-foreground mt-1">
            Replays this branch's commits on top of the target. Pick the base branch to catch up, or another
            session's branch to build on its work.
          </p>
        </div>
      {:else if mode === 'squash'}
        <div>
          <Label for="gitops-squash-base" class="mb-1 block">Squash commits since</Label>
          <Input id="gitops-squash-base" type="text" bind:value={squashBase} placeholder={baseBranch || 'main'} list="gitops-branches" />
        </div>
        <div>
          <div class="text-[10px] text-muted-foreground mb-1">
            {#if squashLoading}
              Loading commits…
            {:else if squashCommits.length === 0}
              No commits since {squashBase || 'the base'}.
            {:else if squashCommits.length === 1}
              Only one commit since {squashBase} — nothing to squash.
            {:else}
              {squashCommits.length} commits will become one:
            {/if}
          </div>
          {#if squashCommits.length > 1}
            <ul class="max-h-28 overflow-y-auto border border-border/50 bg-background/50 text-xs font-mono px-2 py-1 space-y-0.5">
              {#each squashCommits as c (c.sha)}
                <li class="truncate"><span class="text-muted-foreground">{c.shortSha}</span> {c.subject}</li>
              {/each}
            </ul>
          {/if}
        </div>
        <div>
          <Label for="gitops-squash-msg" class="mb-1 block">New commit message</Label>
          <textarea
            id="gitops-squash-msg"
            bind:value={squashMessage}
            rows="4"
            class="w-full text-sm bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          ></textarea>
        </div>
      {:else}
        <div>
          <Label for="gitops-source" class="mb-1 block">Pick from branch</Label>
          <Input id="gitops-source" type="text" bind:value={pickSource} placeholder="another session's branch" list="gitops-branches" />
        </div>
        <div>
          <div class="text-[10px] text-muted-foreground mb-1">
            {#if pickLoading}
              Loading commits…
            {:else if !pickSource.trim()}
              Enter a branch to see its commits.
            {:else if pickCommits.length === 0}
              {pickSource} has no commits that this branch is missing.
            {:else}
              Commits on {pickSource} not on this branch:
            {/if}
          </div>
          {#if pickCommits.length > 0}
            <div class="max-h-40 overflow-y-auto border border-border/50 bg-background/50">
              {#each pickCommits as c (c.sha)}
                <label class="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-accent/30 {pickSha === c.sha ? 'bg-sidebar-accent' : ''}">
                  <input type="radio" name="gitops-pick" value={c.sha} bind:group={pickSha} class="shrink-0" />
                  <span class="font-mono text-muted-foreground shrink-0">{c.shortSha}</span>
                  <span class="truncate">{c.subject}</span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <datalist id="gitops-branches">
        {#each candidates as c (c.branch)}
          <option value={c.branch}>{c.label}</option>
        {/each}
      </datalist>

      {#if result}
        <div class="p-2 text-xs whitespace-pre-wrap border {result.ok ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-destructive/10 border-destructive/50 text-destructive'}">
          {result.text}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => { open = false; onclose(); }}>
          Close
        </Button>
        <Button onclick={run} disabled={!canRun}>
          {#if busy}
            <span class="inline-flex items-center gap-1.5">
              <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              Working…
            </span>
          {:else if mode === 'rebase'}
            Rebase
          {:else if mode === 'squash'}
            Squash {squashCommits.length > 1 ? squashCommits.length : ''} commits
          {:else}
            Cherry-pick
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
