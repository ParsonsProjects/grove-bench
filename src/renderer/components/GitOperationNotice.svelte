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
  let busy = $state<'continue' | 'abort' | null>(null);
  let confirming = $state(false);
  let error = $state('');

  async function act(which: 'continue' | 'abort') {
    confirming = false;
    busy = which;
    error = '';
    try {
      if (which === 'continue') await window.groveBench.continueGitOperation(sessionId, operation.kind);
      else await window.groveBench.abortGitOperation(sessionId, operation.kind);
    } catch (e) {
      error = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
      void gitStatusStore.refresh(sessionId);
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
      {busy === 'continue' ? 'Continuing…' : `Continue ${operation.kind}`}
    </Button>
  {/if}
  <Button size="2xs" variant="quiet" disabled={running || busy !== null} title={running ? WAITS : undefined} onclick={() => (confirming = true)}>
    {busy === 'abort' ? 'Aborting…' : 'Abort'}
  </Button>
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
    <p><span class="text-foreground">{operationTitle(operation)}</span>. {operationNext(operation, conflicts)}</p>
    {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
  </Notice>
{/if}
