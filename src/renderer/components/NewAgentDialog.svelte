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
  let branchSearch = $state('');
  let branchDropdownOpen = $state(false);
  let branchDropdownEl: HTMLDivElement | undefined = $state();

  function handleWindowClick(e: MouseEvent) {
    if (branchDropdownOpen && branchDropdownEl && !branchDropdownEl.contains(e.target as Node)) {
      branchDropdownOpen = false;
    }
  }

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

  let filteredBranches = $derived.by(() => {
    const avail = availableBranches();
    const q = branchSearch.toLowerCase().trim();
    if (!q) return avail;
    return avail.filter((b) => b.toLowerCase().includes(q));
  });

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

<svelte:window onclick={handleWindowClick} />

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
          <Select.Root type="single" value={selectedRepo} onValueChange={(v) => { selectedRepo = v; }}>
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
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="relative" bind:this={branchDropdownEl} onkeydown={(e) => {
              if (e.key === 'Escape') { branchDropdownOpen = false; }
            }}>
              <button
                type="button"
                class="w-full flex items-center justify-between bg-background border border-input px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                onclick={() => { branchDropdownOpen = !branchDropdownOpen; }}
              >
                <span class={selectedBranch ? 'text-foreground' : 'text-muted-foreground'}>
                  {selectedBranch || 'Select branch'}
                </span>
                <svg class="h-4 w-4 opacity-50 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {#if branchDropdownOpen}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                  <div class="p-2 border-b border-border">
                    <input
                      type="text"
                      class="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                      placeholder="Search branches..."
                      bind:value={branchSearch}
                      autofocus
                    />
                  </div>
                  <div class="max-h-48 overflow-y-auto p-1">
                    {#each filteredBranches as branch}
                      <button
                        type="button"
                        class="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors flex items-center gap-2 {branch === selectedBranch ? 'bg-accent' : ''}"
                        onclick={() => { selectedBranch = branch; branchDropdownOpen = false; branchSearch = ''; }}
                      >
                        {#if branch === selectedBranch}
                          <svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        {:else}
                          <span class="w-4 shrink-0"></span>
                        {/if}
                        <span class="truncate">{branch}</span>
                      </button>
                    {:else}
                      <div class="px-2 py-4 text-sm text-muted-foreground text-center">No branches match</div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
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
