<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import type { MergePreflight, MergeResult } from '../../shared/types.js';

  let { sessionId, open, onclose }: {
    sessionId: string;
    open: boolean;
    onclose: () => void;
  } = $props();

  let preflight = $state<MergePreflight | null>(null);
  let error = $state('');
  let merging = $state(false);
  let result = $state<MergeResult | null>(null);

  // (Re)load preflight facts every time the dialog opens — they go stale fast
  // (the agent may commit, the user may switch branches in the repo).
  $effect(() => {
    if (!open) return;
    preflight = null;
    error = '';
    result = null;
    window.groveBench.mergePreflight(sessionId)
      .then(p => { preflight = p; })
      .catch(e => { error = e?.message || String(e); });
  });

  let blocker = $derived.by(() => {
    if (!preflight) return null;
    if (preflight.baseBranch === 'HEAD') {
      return 'The repository is in a detached HEAD state — check out a branch to merge into.';
    }
    if (preflight.baseBranch === preflight.sessionBranch) {
      return 'This session runs on the branch that is checked out in the repository — there is nothing to merge.';
    }
    if (preflight.repoDirty) {
      return 'The repository checkout has uncommitted changes. Commit or stash them there before merging.';
    }
    if (preflight.ahead === 0) {
      return `"${preflight.baseBranch}" already contains every commit on this branch — nothing to merge.`;
    }
    return null;
  });

  async function doMerge() {
    if (merging || blocker || !preflight) return;
    merging = true;
    error = '';
    try {
      result = await window.groveBench.mergeToBase(sessionId);
      if (result.success) gitStatusStore.scheduleRefresh(sessionId, 100);
    } catch (e: any) {
      error = e?.message || String(e);
    } finally {
      merging = false;
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onclose(); }}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Merge into base</Dialog.Title>
      {#if preflight && !result}
        <Dialog.Description>
          Merge <span class="font-mono text-xs text-foreground">{preflight.sessionBranch}</span>
          into <span class="font-mono text-xs text-foreground">{preflight.baseBranch}</span>
          (the branch checked out in the repository).
        </Dialog.Description>
      {/if}
    </Dialog.Header>

    {#if result?.success}
      <div class="flex items-center gap-2 text-sm text-green-400">
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        Merged into <span class="font-mono text-xs">{result.baseBranch}</span>.
      </div>
      <Dialog.Footer>
        <Button onclick={onclose}>Close</Button>
      </Dialog.Footer>
    {:else if result}
      <div class="space-y-2 text-sm">
        <div class="text-destructive">
          Merge conflicts in {result.conflicts.length} file{result.conflicts.length !== 1 ? 's' : ''} —
          the merge was aborted and <span class="font-mono text-xs">{result.baseBranch}</span> is unchanged.
        </div>
        <ul class="max-h-40 overflow-y-auto border border-border/50 bg-card/30 px-3 py-2 space-y-0.5">
          {#each result.conflicts as file}
            <li class="font-mono text-xs text-muted-foreground break-all">{file}</li>
          {/each}
        </ul>
        <p class="text-xs text-muted-foreground">
          To resolve, ask the agent to merge
          <span class="font-mono">{result.baseBranch}</span> into its branch and fix the
          conflicts, then merge again.
        </p>
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={onclose}>Close</Button>
      </Dialog.Footer>
    {:else}
      {#if error}
        <div class="text-sm text-destructive break-words">{error}</div>
      {:else if !preflight}
        <div class="text-sm text-muted-foreground">Checking branches…</div>
      {:else}
        <div class="space-y-2 text-sm">
          <div class="text-muted-foreground">
            {preflight.ahead} commit{preflight.ahead !== 1 ? 's' : ''} to merge
            {#if preflight.behind > 0}
              · base is {preflight.behind} commit{preflight.behind !== 1 ? 's' : ''} ahead of this branch
            {/if}
          </div>
          {#if preflight.worktreeDirty && !blocker}
            <div class="text-xs text-yellow-400">
              This session's worktree has uncommitted changes — they will not be included in the merge.
            </div>
          {/if}
          {#if blocker}
            <div class="text-xs text-destructive">{blocker}</div>
          {/if}
        </div>
      {/if}
      <Dialog.Footer>
        <Button variant="outline" onclick={onclose}>Cancel</Button>
        <Button onclick={doMerge} disabled={!preflight || !!blocker || merging || !!error}>
          {merging ? 'Merging…' : 'Merge'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
