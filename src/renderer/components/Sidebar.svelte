<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';

  let showNewAgent = $state(false);
  let newAgentDefaultRepo = $state('');
  let confirmDestroyId = $state<string | null>(null);
  let destroying = $state<string | null>(null);
  let confirmRemoveRepo = $state<string | null>(null);
  let deleteBranchOnDestroy = $state(false);

  function focusSession(id: string) {
    store.activeSessionId = id;
  }

  function openNewAgent(defaultRepo = '') {
    newAgentDefaultRepo = defaultRepo;
    showNewAgent = true;
  }

  function requestDestroy(id: string) {
    confirmDestroyId = id;
    deleteBranchOnDestroy = false;
  }

  async function confirmDestroy() {
    if (!confirmDestroyId) return;
    const id = confirmDestroyId;
    const deleteBranch = deleteBranchOnDestroy;
    confirmDestroyId = null;
    destroying = id;

    try {
      await window.groveBench.destroySession(id, deleteBranch);
      store.removeSession(id);
    } catch (e: any) {
      store.setError(e.message || String(e));
    } finally {
      destroying = null;
    }
  }

  async function handleRemoveRepo(repoPath: string) {
    try {
      await window.groveBench.removeRepo(repoPath);
      store.removeRepo(repoPath);
    } catch (e: any) {
      store.setError(e.message || String(e));
    }
    confirmRemoveRepo = null;
  }

  const statusColor: Record<string, string> = {
    running: 'bg-green-500',
    starting: 'bg-yellow-500',
    stopped: 'bg-neutral-500',
    error: 'bg-red-500',
  };
</script>

<aside class="w-60 border-r border-neutral-800 flex flex-col bg-neutral-950 shrink-0">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-neutral-800">
    <h1 class="text-sm font-bold tracking-wide text-neutral-300">GROVE BENCH</h1>
  </div>

  <!-- Repo-grouped sessions -->
  <div class="flex-1 overflow-auto px-3 py-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-neutral-500 uppercase tracking-wide">Repositories</span>
      <span class="text-xs text-neutral-600">{store.count} {store.count === 1 ? 'agent' : 'agents'}</span>
    </div>

    {#each store.repos as repo (repo)}
      {@const repoSessions = store.sessionsForRepo(repo)}
      {@const canRemove = store.canRemoveRepo(repo)}
      <div class="mb-3">
        <!-- Repo header -->
        <div class="flex items-center justify-between group px-1 py-1">
          <span class="text-xs font-medium text-neutral-400 truncate" title={repo}>
            {store.repoDisplayName(repo)}
          </span>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if store.canCreate}
              <button
                onclick={() => openNewAgent(repo)}
                class="text-neutral-500 hover:text-blue-400 text-xs px-1"
                title="New agent in this repo"
              >+</button>
            {/if}
            <button
              onclick={() => canRemove ? confirmRemoveRepo = repo : null}
              disabled={!canRemove}
              class="text-neutral-500 hover:text-red-400 disabled:text-neutral-700 disabled:cursor-not-allowed text-xs px-1"
              title={canRemove ? 'Remove repository' : 'Destroy all sessions first'}
            >&times;</button>
          </div>
        </div>

        <!-- Sessions under this repo -->
        {#each repoSessions as session (session.id)}
          <button
            onclick={() => focusSession(session.id)}
            class="w-full flex items-center justify-between pl-4 pr-2 py-1.5 rounded text-left group/session transition-colors
              {store.activeSessionId === session.id ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'}"
          >
            <div class="flex items-center gap-2 min-w-0">
              {#if destroying === session.id}
                <span class="w-2 h-2 border border-neutral-400 border-t-transparent rounded-full animate-spin shrink-0"></span>
              {:else}
                <span class="w-2 h-2 rounded-full {statusColor[session.status] || 'bg-neutral-500'} {session.status === 'running' && messageStore.getIsRunning(session.id) ? 'animate-pulse' : ''} shrink-0"></span>
              {/if}
              <span class="text-sm truncate">{session.branch}</span>
            </div>
            <span
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); requestDestroy(session.id); }}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') requestDestroy(session.id); }}
              class="text-neutral-600 hover:text-red-400 opacity-0 group-hover/session:opacity-100 text-xs cursor-pointer"
            >
              &times;
            </span>
          </button>
        {/each}

        {#if repoSessions.length === 0}
          <p class="text-xs text-neutral-600 pl-4 py-1">No agents</p>
        {/if}
      </div>
    {/each}

    {#if store.repos.length === 0}
      <p class="text-xs text-neutral-600 mt-2">Add a repository to get started.</p>
    {/if}
  </div>

  <!-- Bottom controls -->
  <div class="px-3 py-3 border-t border-neutral-800 flex flex-col gap-2">
    <AddRepoButton />
    <button
      onclick={() => openNewAgent()}
      disabled={!store.canCreate}
      class="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 rounded text-sm transition-colors"
    >
      + New Agent
    </button>
  </div>
</aside>

{#if showNewAgent}
  <NewAgentDialog onclose={() => showNewAgent = false} defaultRepo={newAgentDefaultRepo} />
{/if}

<!-- Destroy session confirmation dialog -->
{#if confirmDestroyId}
  {@const session = store.sessions.find(s => s.id === confirmDestroyId)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    onclick={() => confirmDestroyId = null}
    onkeydown={(e) => e.key === 'Escape' && (confirmDestroyId = null)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-neutral-900 border border-neutral-700 rounded-lg w-80 p-6 shadow-xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold mb-3">Destroy Agent?</h2>
      <p class="text-sm text-neutral-400 mb-3">
        This will kill the shell process and remove the worktree for branch
        <span class="text-neutral-200 font-medium">{session?.branch ?? 'unknown'}</span>.
      </p>
      <label class="flex items-center gap-2 text-sm text-neutral-400 mb-4 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={deleteBranchOnDestroy}
          class="rounded border-neutral-600 bg-neutral-800"
        />
        Also delete the branch
      </label>
      <div class="flex gap-2 justify-end">
        <button
          onclick={() => confirmDestroyId = null}
          class="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onclick={confirmDestroy}
          class="px-4 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm"
        >
          Destroy
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Remove repo confirmation dialog -->
{#if confirmRemoveRepo}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    onclick={() => confirmRemoveRepo = null}
    onkeydown={(e) => e.key === 'Escape' && (confirmRemoveRepo = null)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-neutral-900 border border-neutral-700 rounded-lg w-80 p-6 shadow-xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold mb-3">Remove Repository?</h2>
      <p class="text-sm text-neutral-400 mb-4">
        Remove <span class="text-neutral-200 font-medium">{store.repoDisplayName(confirmRemoveRepo)}</span> from Grove Bench?
        This won't delete any files on disk.
      </p>
      <div class="flex gap-2 justify-end">
        <button
          onclick={() => confirmRemoveRepo = null}
          class="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onclick={() => confirmRemoveRepo && handleRemoveRepo(confirmRemoveRepo)}
          class="px-4 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
{/if}
