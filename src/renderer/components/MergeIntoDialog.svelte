<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { candidateBranches, describeMergePlan, describeMergeResult } from '../lib/git-ops.js';
  import type { MergeIntoPlan } from '../../shared/types.js';

  /**
   * Merge the conversation's branch into another branch (its base by
   * default) in the project folder. Shows what will happen first; main
   * checks everything again before it merges and aborts on a conflict.
   */
  let { sessionId, target: initialTarget, onclose }: { sessionId: string; target: string; onclose: () => void } = $props();

  let open = $state(true);
  let target = $state(untrack(() => initialTarget));
  let plan = $state<MergeIntoPlan | null>(null);
  let planError = $state('');
  let checking = $state(false);
  let busy = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let candidates = $derived(candidateBranches(store.sessions, sessionId, initialTarget));
  let described = $derived(plan && !plan.blocked ? describeMergePlan(plan) : null);
  let canMerge = $derived(!!plan && !plan.blocked && !busy && !checking && !result?.ok);

  let checkSeq = 0;
  async function check() {
    const seq = ++checkSeq;
    checking = true;
    planError = '';
    result = null;
    try {
      const next = await window.groveBench.gitMergePlan(sessionId, target.trim());
      if (seq === checkSeq) plan = next;
    } catch (e: any) {
      if (seq === checkSeq) { plan = null; planError = e?.message || String(e); }
    } finally {
      if (seq === checkSeq) checking = false;
    }
  }

  onMount(check);

  async function merge() {
    if (!canMerge || !plan) return;
    busy = true;
    try {
      const r = await window.groveBench.gitMergeInto(sessionId, plan.target);
      result = describeMergeResult(r, plan.target);
      if (r.success) {
        gitStatusStore.refresh(sessionId);
        prStore.refresh(sessionId, true).catch(() => {});
      }
    } catch (e: any) {
      result = { ok: false, text: e?.message || String(e) };
    } finally {
      busy = false;
    }
  }

  function close() {
    open = false;
    onclose();
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Merge into {target.trim() || '…'}</Dialog.Title>
      <Dialog.Description>
        Bring the work committed on <span class="font-mono text-foreground">{plan?.branch || session?.branch || 'this branch'}</span>
        into another branch in your project folder. If both changed the same lines, the merge is stopped and nothing changes.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-3">
      <div>
        <Label for="merge-target" class="mb-1 block">Merge into</Label>
        <Input
          id="merge-target"
          type="text"
          bind:value={target}
          list="merge-targets"
          onchange={check}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); check(); } }}
        />
        <datalist id="merge-targets">
          {#each candidates as c (c.branch)}
            <option value={c.branch}>{c.label}</option>
          {/each}
        </datalist>
      </div>

      {#if checking}
        <p class="text-xs text-muted-foreground flex items-center gap-1.5">
          <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
          Checking…
        </p>
      {:else if planError}
        <div class="p-2 text-xs border bg-destructive/10 border-destructive/50 text-destructive" role="alert">{planError}</div>
      {:else if plan?.blocked}
        <div class="p-2 text-xs border bg-yellow-500/10 border-yellow-500/40 text-foreground/90" role="status">{plan.blocked}</div>
      {:else if described}
        <p class="text-xs text-foreground/90">{described.summary}</p>
        {#if plan?.checkoutPath}
          <p class="text-[11px] text-muted-foreground font-mono truncate" title={plan.checkoutPath}>{plan.checkoutPath}</p>
        {/if}
        {#if described.note}
          <p class="text-xs text-yellow-500">{described.note}</p>
        {/if}
      {/if}

      {#if result}
        <div class="p-2 text-xs whitespace-pre-wrap border {result.ok ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-destructive/10 border-destructive/50 text-destructive'}" role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>{result?.ok ? 'Done' : 'Cancel'}</Button>
        <Button onclick={merge} disabled={!canMerge}>
          {#if busy}
            <span class="inline-flex items-center gap-1.5">
              <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              Merging…
            </span>
          {:else}
            Merge
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
