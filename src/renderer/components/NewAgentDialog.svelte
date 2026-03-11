<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(defaultRepo || store.repos[0] || '');
  let branchName = $state('');
  let baseBranch = $state('');
  let creating = $state(false);
  let dialogError = $state('');

  let mode = $state<'new' | 'existing'>('new');
  let branches = $state<string[]>([]);
  let loadingBranches = $state(false);
  let selectedBranch = $state('');

  function usedBranches(): Set<string> {
    return new Set(
      store.sessions
        .filter((s) => s.repoPath === selectedRepo)
        .map((s) => s.branch)
    );
  }

  function availableBranches(): string[] {
    const used = usedBranches();
    return branches.filter((b) => !used.has(b));
  }

  async function fetchBranches() {
    if (!selectedRepo) return;
    loadingBranches = true;
    selectedBranch = '';
    dialogError = '';
    try {
      branches = await window.groveBench.listBranches(selectedRepo);
      const avail = availableBranches();
      selectedBranch = avail[0] || '';
    } catch (e: any) {
      dialogError = e.message || String(e);
      branches = [];
      selectedBranch = '';
    } finally {
      loadingBranches = false;
    }
  }

  $effect(() => {
    if (mode === 'existing' && selectedRepo) {
      fetchBranches();
    }
  });

  async function handleCreate() {
    if (!selectedRepo) return;
    if (mode === 'new' && !branchName.trim()) return;
    if (mode === 'existing' && !selectedBranch) return;

    creating = true;
    dialogError = '';

    try {
      const opts = mode === 'existing'
        ? { repoPath: selectedRepo, branchName: selectedBranch, useExisting: true as const }
        : { repoPath: selectedRepo, branchName: branchName.trim(), baseBranch: baseBranch.trim() || undefined };

      const result = await window.groveBench.createSession(opts);
      store.addSession({ id: result.id, branch: result.branch, repoPath: selectedRepo, status: 'running' });
      open = false;
      onclose();
    } catch (e: any) {
      dialogError = e.message || String(e);
    } finally {
      creating = false;
    }
  }

  function canCreate(): boolean {
    if (!selectedRepo || creating) return false;
    if (mode === 'new') return !!branchName.trim();
    return !!selectedBranch;
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      open = false;
      onclose();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-sm">
    <Dialog.Header>
      <Dialog.Title>New Agent</Dialog.Title>
      <Dialog.Description>Create a new agent session in a worktree branch.</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-4">
      <div>
        <Label for="repo" class="mb-1 block">Repository</Label>
        {#if store.repos.length === 1}
          <div class="w-full bg-secondary text-muted-foreground px-3 py-2 text-sm border border-input">
            {store.repoDisplayName(store.repos[0])}
          </div>
        {:else}
          <Select.Root bind:value={selectedRepo}>
            <Select.Trigger class="w-full">
              {store.repoDisplayName(selectedRepo) || 'Select repository'}
            </Select.Trigger>
            <Select.Content>
              {#each store.repos as repo}
                <Select.Item value={repo} label={store.repoDisplayName(repo)} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>

      <!-- Mode toggle -->
      <div>
        <Label class="mb-1 block">Branch Mode</Label>
        <div class="flex overflow-hidden border border-input">
          <Button
            variant={mode === 'new' ? 'default' : 'secondary'}
            class="flex-1 rounded-none border-0"
            size="sm"
            onclick={() => mode = 'new'}
          >
            New branch
          </Button>
          <Button
            variant={mode === 'existing' ? 'default' : 'secondary'}
            class="flex-1 rounded-none border-0"
            size="sm"
            onclick={() => mode = 'existing'}
          >
            Existing branch
          </Button>
        </div>
      </div>

      {#if mode === 'new'}
        <div>
          <Label for="branch" class="mb-1 block">Branch Name</Label>
          <Input
            id="branch"
            type="text"
            bind:value={branchName}
            placeholder="e.g. agent/add-auth"
            autofocus
          />
        </div>

        <div>
          <Label for="base" class="mb-1 block">Base Branch (optional)</Label>
          <Input
            id="base"
            type="text"
            bind:value={baseBranch}
            placeholder="defaults to current HEAD"
          />
        </div>
      {:else}
        <div>
          <Label for="existing-branch" class="mb-1 block">Branch</Label>
          {#if loadingBranches}
            <div class="w-full bg-secondary text-muted-foreground px-3 py-2 text-sm border border-input">
              Loading branches...
            </div>
          {:else if availableBranches().length === 0}
            <div class="w-full bg-secondary text-muted-foreground px-3 py-2 text-sm border border-input">
              No available branches
            </div>
          {:else}
            <Select.Root bind:value={selectedBranch}>
              <Select.Trigger class="w-full">
                {selectedBranch || 'Select branch'}
              </Select.Trigger>
              <Select.Content>
                {#each availableBranches() as branch}
                  <Select.Item value={branch} label={branch} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
        </div>
      {/if}

      <p class="text-xs text-muted-foreground">
        New worktrees don't include node_modules. The agent may need to run npm install first.
      </p>

      {#if dialogError}
        <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive">
          {dialogError}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => { open = false; onclose(); }}>
          Cancel
        </Button>
        <Button
          onclick={handleCreate}
          disabled={!canCreate()}
        >
          {creating ? 'Creating...' : 'Create'}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
