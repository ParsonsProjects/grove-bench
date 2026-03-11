<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

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

<aside class="w-60 border-r border-sidebar-border flex flex-col bg-sidebar shrink-0">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-sidebar-border">
    <h1 class="text-sm font-bold tracking-wide text-sidebar-foreground">GROVE BENCH</h1>
  </div>

  <!-- Repo-grouped sessions -->
  <div class="flex-1 overflow-auto px-3 py-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Repositories</span>
      <span class="text-xs text-muted-foreground/60">{store.count} {store.count === 1 ? 'agent' : 'agents'}</span>
    </div>

    {#each store.repos as repo (repo)}
      {@const repoSessions = store.sessionsForRepo(repo)}
      {@const canRemove = store.canRemoveRepo(repo)}
      <div class="mb-3">
        <!-- Repo header -->
        <div class="flex items-center justify-between group px-1 py-1">
          <span class="text-xs font-medium text-muted-foreground truncate" title={repo}>
            {store.repoDisplayName(repo)}
          </span>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if store.canCreate}
              <button
                onclick={() => openNewAgent(repo)}
                class="text-muted-foreground hover:text-primary text-xs px-1"
                title="New agent in this repo"
              >+</button>
            {/if}
            <button
              onclick={() => canRemove ? confirmRemoveRepo = repo : null}
              disabled={!canRemove}
              class="text-muted-foreground hover:text-destructive disabled:text-muted-foreground/30 disabled:cursor-not-allowed text-xs px-1"
              title={canRemove ? 'Remove repository' : 'Destroy all sessions first'}
            >&times;</button>
          </div>
        </div>

        <!-- Sessions under this repo -->
        {#each repoSessions as session (session.id)}
          <button
            onclick={() => focusSession(session.id)}
            class="w-full flex items-center justify-between pl-4 pr-2 py-1.5 text-left group/session transition-colors
              {store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
          >
            <div class="flex items-center gap-2 min-w-0">
              {#if destroying === session.id}
                <span class="w-2 h-2 border border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0"></span>
              {:else}
                <span class="w-2 h-2 {statusColor[session.status] || 'bg-neutral-500'} {session.status === 'running' && messageStore.getIsRunning(session.id) ? 'animate-pulse' : ''} shrink-0"></span>
              {/if}
              <span class="text-sm truncate">{session.branch}</span>
            </div>
            <span
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); requestDestroy(session.id); }}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') requestDestroy(session.id); }}
              class="text-muted-foreground/40 hover:text-destructive opacity-0 group-hover/session:opacity-100 text-xs cursor-pointer"
            >
              &times;
            </span>
          </button>
        {/each}

        {#if repoSessions.length === 0}
          <p class="text-xs text-muted-foreground/50 pl-4 py-1">No agents</p>
        {/if}
      </div>
    {/each}

    {#if store.repos.length === 0}
      <p class="text-xs text-muted-foreground/50 mt-2">Add a repository to get started.</p>
    {/if}
  </div>

  <!-- Bottom controls -->
  <div class="px-3 py-3 border-t border-sidebar-border flex flex-col gap-2">
    <AddRepoButton />
    <Button
      onclick={() => openNewAgent()}
      disabled={!store.canCreate}
      class="w-full"
      size="sm"
    >
      + New Agent
    </Button>
  </div>
</aside>

{#if showNewAgent}
  <NewAgentDialog onclose={() => showNewAgent = false} defaultRepo={newAgentDefaultRepo} />
{/if}

<!-- Destroy session confirmation dialog -->
{#if confirmDestroyId}
  {@const session = store.sessions.find(s => s.id === confirmDestroyId)}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmDestroyId = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Destroy Agent?</Dialog.Title>
        <Dialog.Description>
          This will kill the shell process and remove the worktree for branch
          <span class="text-foreground font-medium">{session?.branch ?? 'unknown'}</span>.
        </Dialog.Description>
      </Dialog.Header>
      <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
        <Checkbox bind:checked={deleteBranchOnDestroy} />
        Also delete the branch
      </label>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmDestroyId = null}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={confirmDestroy}>
          Destroy
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Remove repo confirmation dialog -->
{#if confirmRemoveRepo}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmRemoveRepo = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Remove Repository?</Dialog.Title>
        <Dialog.Description>
          Remove <span class="text-foreground font-medium">{store.repoDisplayName(confirmRemoveRepo)}</span> from Grove Bench?
          This won't delete any files on disk.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmRemoveRepo = null}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={() => confirmRemoveRepo && handleRemoveRepo(confirmRemoveRepo)}>
          Remove
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
