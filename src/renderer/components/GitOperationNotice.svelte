<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Confirm } from '$lib/components/ui/confirm/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { operationNext, operationTitle } from '../lib/git-operation.js';
  import type { GitOperation } from '../../shared/types.js';

  /** A merge, rebase, cherry-pick or revert stopped part way, across the top
   *  of the Changes tab: what it is, what's left, and Continue or Abort. A
   *  merge is finished from the commit box instead. */
  let { sessionId, operation, conflicts }: { sessionId: string; operation: GitOperation; conflicts: number } = $props();

  // The agent may be the one running it, or editing what it touches.
  let running = $derived(messageStore.getIsRunning(sessionId));
  let inBranchView = $derived(gitStatusStore.getScope(sessionId).scope === 'branch');
  let busy = $state<'continue' | 'abort' | null>(null);
  let confirming = $state(false);
  let error = $state('');
  // An error is dropped once git moves on a step. One from a Continue that
  // moved on and then stopped is about the step it moved to: the store
  // reloads before the call settles, so that step is in by then.
  let step = $derived(`${operation.kind} ${operation.step ?? ''} ${operation.commit ?? ''}`);
  $effect(() => {
    void step;
    error = '';
  });

  async function act(which: 'continue' | 'abort') {
    confirming = false;
    busy = which;
    error = '';
    try {
      if (which === 'continue') await gitStatusStore.continueOperation(sessionId, operation.kind);
      else await gitStatusStore.abortOperation(sessionId, operation.kind);
    } catch (e) {
      error = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
    }
  }

  const WAITS = 'Waits for the agent to finish its turn';
</script>

{#snippet actions()}
  {#if operation.kind !== 'merge'}
    <Button
      size="2xs"
      variant="link"
      disabled={conflicts > 0 || running || busy !== null}
      title={conflicts > 0 ? 'Mark each conflict resolved first' : running ? WAITS : `git ${operation.kind} --continue`}
      onclick={() => act('continue')}
    >
      {busy === 'continue' ? 'Continuing…' : operation.passesOver ? `Skip ${operation.passesOver}` : `Continue ${operation.kind}`}
    </Button>
  {/if}
  <!-- Past a commit made by hand, git's abort wouldn't take the branch back. -->
  {#if !operation.byHand}
    <Button size="2xs" variant="quiet" disabled={running || busy !== null} title={running ? WAITS : undefined} onclick={() => (confirming = true)}>
      {busy === 'abort' ? 'Aborting…' : 'Abort'}
    </Button>
  {/if}
{/snippet}

{#if confirming}
  <Confirm
    class="shrink-0 border-b border-border px-3 py-2"
    message={`Abort the ${operation.kind}? The branch goes back to how it was before it started, and the conflicts you resolved are lost.`}
    confirm={`Abort ${operation.kind}`}
    oncancel={() => (confirming = false)}
    onconfirm={() => act('abort')}
  />
{:else}
  <Notice tone="warning" class="shrink-0 border-b border-b-border" {actions}>
    <p><span class="text-foreground">{operationTitle(operation)}</span>. {operationNext(operation, conflicts, inBranchView)}</p>
    {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
  </Notice>
{/if}
