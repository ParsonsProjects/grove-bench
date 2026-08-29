<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';

  let { sessionId, onclose }: { sessionId: string; onclose: () => void } = $props();

  let open = $state(true);
  let title = $state('');
  let body = $state('');
  let base = $state(settingsStore.current.defaultBaseBranch?.trim() || 'main');
  let draft = $state(false);
  let creating = $state(false);
  let dialogError = $state('');
  let prefilled = $state(false);

  let sessionBranch = $derived(store.sessions.find((s) => s.id === sessionId)?.branch ?? '');

  /** "feature/add-user-auth" → "Add user auth" */
  function humanizeBranch(branch: string): string {
    const leaf = branch.split('/').pop() ?? branch;
    const words = leaf.replace(/[-_]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : branch;
  }

  async function prefillFromCommits() {
    try {
      const commits = await window.groveBench.getBranchCommits(sessionId, base);
      if (title.trim() || body.trim()) return; // user already typed something
      if (commits.length === 1) {
        title = commits[0].subject;
        body = commits[0].body;
      } else if (commits.length > 1) {
        title = humanizeBranch(sessionBranch);
        // git log is newest-first; bullets read better in commit order
        body = [...commits].reverse().map((c) => `- ${c.subject}`).join('\n');
      } else {
        title = humanizeBranch(sessionBranch);
      }
      prefilled = true;
    } catch {
      // prefill is best-effort
    }
  }

  onMount(prefillFromCommits);

  async function handleCreate() {
    if (!title.trim() || creating) return;
    creating = true;
    dialogError = '';
    try {
      const pr = await prStore.createPr(sessionId, {
        title: title.trim(),
        body,
        base: base.trim(),
        draft,
      });
      open = false;
      onclose();
      window.groveBench.openExternal(pr.url);
    } catch (e: any) {
      dialogError = e?.message || String(e);
    } finally {
      creating = false;
    }
  }

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
      <Dialog.Title>Create Pull Request</Dialog.Title>
      <Dialog.Description>
        Push <span class="font-mono text-foreground">{sessionBranch}</span> and open a PR on GitHub.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-4">
      <div>
        <Label for="pr-title" class="mb-1 block">Title</Label>
        <!-- svelte-ignore a11y_autofocus -->
        <Input
          id="pr-title"
          type="text"
          bind:value={title}
          placeholder="Summary of the changes"
          autofocus
        />
      </div>

      <div>
        <Label for="pr-body" class="mb-1 block">Description</Label>
        <textarea
          id="pr-body"
          bind:value={body}
          rows="6"
          placeholder="What changed and why…"
          class="w-full text-sm bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        ></textarea>
        {#if prefilled}
          <p class="text-[10px] text-muted-foreground mt-1">Pre-filled from the branch's commits.</p>
        {/if}
      </div>

      <div class="flex items-end gap-3">
        <div class="flex-1">
          <Label for="pr-base" class="mb-1 block">Base Branch</Label>
          <Input id="pr-base" type="text" bind:value={base} placeholder="main" />
        </div>
        <label class="flex items-center gap-2 pb-2 text-sm text-muted-foreground cursor-pointer">
          <Checkbox bind:checked={draft} />
          Draft
        </label>
      </div>

      {#if dialogError}
        <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive whitespace-pre-wrap">
          {dialogError}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => { open = false; onclose(); }}>
          Cancel
        </Button>
        <Button onclick={handleCreate} disabled={!title.trim() || creating}>
          {#if creating}
            <span class="inline-flex items-center gap-1.5">
              <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              Creating…
            </span>
          {:else}
            {draft ? 'Create Draft PR' : 'Create PR'}
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
