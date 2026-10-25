<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Confirm } from '$lib/components/ui/confirm/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import type { GitOperation } from '../../shared/types.js';

  /** A merge, rebase, cherry-pick or revert waiting on the user. */
  let { operation, conflicts, layout }: { operation: GitOperation; conflicts: number; layout: 'strip' | 'footer' } = $props();

  let confirming = $state(false);

  const VERB = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' } as const;
  let what = $derived(
    operation.kind === 'merge' ? `Merging ${operation.incoming} into ${operation.branch}`
      : operation.kind === 'rebase' ? `Rebasing ${operation.branch} onto ${operation.incoming}`
      : operation.kind === 'cherry-pick' ? `Cherry-picking ${operation.commit}`
      : `Reverting ${operation.commit}`,
  );
  let short = $derived(
    operation.kind === 'merge' ? `Merging ${operation.incoming}`
      : operation.kind === 'rebase' ? `Rebasing onto ${operation.incoming}`
      : operation.kind === 'cherry-pick' ? `Cherry-picking ${operation.commit}`
      : `Reverting ${operation.commit}`,
  );
  let progress = $derived(operation.kind === 'rebase' && operation.total ? `step ${operation.step} of ${operation.total}` : '');
  let finish = $derived(operation.kind === 'merge' ? 'commit' : 'continue');
  let next = $derived(
    conflicts > 0
      ? `Resolve ${conflicts} conflict${conflicts === 1 ? '' : 's'}, then ${finish}.`
      : operation.kind === 'merge' ? 'All conflicts resolved: commit to finish the merge.' : `All conflicts resolved: continue the ${VERB[operation.kind]}.`,
  );
  let abortText = $derived(
    `Abort the ${VERB[operation.kind]}? The branch goes back to how it was before it started, and the conflicts you resolved are lost.`,
  );
</script>

{#snippet actions()}
  {#if operation.kind !== 'merge'}
    <Button size="2xs" variant="link" disabled={conflicts > 0} title={conflicts > 0 ? 'Mark each conflict resolved first' : ''}>Continue {VERB[operation.kind]}</Button>
  {/if}
  <Button size="2xs" variant="quiet" onclick={() => (confirming = true)}>Abort</Button>
{/snippet}

{#if layout === 'strip'}
  {#if confirming}
    <Confirm class="shrink-0 border-b border-border px-3 py-2" message={abortText} confirm={`Abort ${VERB[operation.kind]}`} oncancel={() => (confirming = false)} onconfirm={() => (confirming = false)} />
  {:else}
    <Notice tone="warning" class="shrink-0 border-b border-b-border" {actions}>
      <p><span class="text-foreground">{what}</span>{progress ? `, ${progress}` : ''}. {next}</p>
    </Notice>
  {/if}
{:else}
  <!-- The file list's column is narrow: a short title, and the buttons stacked. -->
  <div class="border-t border-border p-2 shrink-0 space-y-1.5">
    {#if confirming}
      <Confirm message={abortText} confirm={`Abort ${VERB[operation.kind]}`} stretch oncancel={() => (confirming = false)} onconfirm={() => (confirming = false)} />
    {:else}
      <div class="flex items-baseline gap-2">
        <span class="w-2 h-2 shrink-0 bg-status-attention translate-y-px"></span>
        <p class="flex-1 min-w-0 truncate text-xs text-foreground" title={what}>{short}</p>
        {#if operation.kind === 'rebase' && operation.total}<span class="text-caption text-muted-foreground shrink-0">{operation.step}/{operation.total}</span>{/if}
      </div>
      <p class="text-caption text-muted-foreground">{next}</p>
      {#if operation.kind !== 'merge'}
        <Button size="xs" class="w-full disabled:cursor-not-allowed" disabled={conflicts > 0} title={conflicts > 0 ? 'Mark each conflict resolved first' : ''}>Continue {VERB[operation.kind]}</Button>
      {/if}
      <Button size="xs" variant="outline-destructive" class="w-full" onclick={() => (confirming = true)}>Abort {VERB[operation.kind]}…</Button>
    {/if}
  </div>
{/if}
