<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let selectedRepo = $state(defaultRepo || store.repos[0] || '');
  let branchName = $state('');
  let baseBranch = $state('');
  let creating = $state(false);
  let dialogError = $state('');

  let mode = $state<'new' | 'existing'>('new');
  let branches = $state<string[]>([]);
  let loadingBranches = $state(false);
  let selectedBranch = $state('');

  // Branches already in use by active sessions for the selected repo
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

  // Fetch branches when switching to existing mode or when repo changes in existing mode
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
      onclose();
    } catch (e: any) {
      dialogError = e.message || String(e);
    } finally {
      creating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    if (e.key === 'Enter' && canCreate()) handleCreate();
  }

  function canCreate(): boolean {
    if (!selectedRepo || creating) return false;
    if (mode === 'new') return !!branchName.trim();
    return !!selectedBranch;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
  onclick={onclose}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-neutral-900 border border-neutral-700 rounded-lg w-96 p-6 shadow-xl"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <h2 class="text-lg font-semibold mb-4">New Agent</h2>

    <div class="flex flex-col gap-3">
      <div>
        <label for="repo" class="block text-xs text-neutral-400 mb-1">Repository</label>
        {#if store.repos.length === 1}
          <div class="w-full bg-neutral-800 text-neutral-300 px-3 py-2 rounded text-sm border border-neutral-700">
            {store.repoDisplayName(store.repos[0])}
          </div>
        {:else}
          <select
            id="repo"
            bind:value={selectedRepo}
            class="w-full bg-neutral-800 text-white px-3 py-2 rounded text-sm border border-neutral-700 focus:border-blue-500 focus:outline-none"
          >
            {#each store.repos as repo}
              <option value={repo}>{store.repoDisplayName(repo)}</option>
            {/each}
          </select>
        {/if}
      </div>

      <!-- Mode toggle -->
      <div>
        <label class="block text-xs text-neutral-400 mb-1">Branch Mode</label>
        <div class="flex rounded overflow-hidden border border-neutral-700">
          <button
            class="flex-1 px-3 py-1.5 text-sm transition-colors {mode === 'new' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
            onclick={() => mode = 'new'}
          >
            New branch
          </button>
          <button
            class="flex-1 px-3 py-1.5 text-sm transition-colors {mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
            onclick={() => mode = 'existing'}
          >
            Existing branch
          </button>
        </div>
      </div>

      {#if mode === 'new'}
        <div>
          <label for="branch" class="block text-xs text-neutral-400 mb-1">Branch Name</label>
          <input
            id="branch"
            type="text"
            bind:value={branchName}
            placeholder="e.g. agent/add-auth"
            autofocus
            class="w-full bg-neutral-800 text-white px-3 py-2 rounded text-sm border border-neutral-700 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label for="base" class="block text-xs text-neutral-400 mb-1">Base Branch (optional)</label>
          <input
            id="base"
            type="text"
            bind:value={baseBranch}
            placeholder="defaults to current HEAD"
            class="w-full bg-neutral-800 text-white px-3 py-2 rounded text-sm border border-neutral-700 focus:border-blue-500 focus:outline-none"
          />
        </div>
      {:else}
        <div>
          <label for="existing-branch" class="block text-xs text-neutral-400 mb-1">Branch</label>
          {#if loadingBranches}
            <div class="w-full bg-neutral-800 text-neutral-500 px-3 py-2 rounded text-sm border border-neutral-700">
              Loading branches...
            </div>
          {:else if availableBranches().length === 0}
            <div class="w-full bg-neutral-800 text-neutral-500 px-3 py-2 rounded text-sm border border-neutral-700">
              No available branches
            </div>
          {:else}
            <select
              id="existing-branch"
              bind:value={selectedBranch}
              class="w-full bg-neutral-800 text-white px-3 py-2 rounded text-sm border border-neutral-700 focus:border-blue-500 focus:outline-none"
            >
              {#each availableBranches() as branch}
                <option value={branch}>{branch}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}

      <p class="text-xs text-neutral-500">
        New worktrees don't include node_modules. The agent may need to run npm install first.
      </p>

      {#if dialogError}
        <div class="bg-red-900/50 border border-red-700 rounded p-2 text-xs text-red-200">
          {dialogError}
        </div>
      {/if}

      <div class="flex gap-2 justify-end mt-2">
        <button
          onclick={onclose}
          class="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={handleCreate}
          disabled={!canCreate()}
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded text-sm transition-colors"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </div>
</div>
