<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import PluginPanel from './PluginPanel.svelte';

  let showNewAgent = $state(false);
  let showPlugins = $state(false);
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
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if store.canCreate}
              <button
                onclick={() => openNewAgent(repo)}
                class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-sidebar-accent transition-colors"
                title="New agent in this repo"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              </button>
            {/if}
            <button
              onclick={() => canRemove ? confirmRemoveRepo = repo : null}
              disabled={!canRemove}
              class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:text-muted-foreground/30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title={canRemove ? 'Remove repository' : 'Destroy all sessions first'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
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
              {#if session.direct}
                <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Direct (no worktree)"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
              {:else}
                <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Worktree"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>
              {/if}
              <span class="text-sm truncate">{session.branch}</span>
            </div>
            <span
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); requestDestroy(session.id); }}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') requestDestroy(session.id); }}
              class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 cursor-pointer transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
    <div class="flex gap-2">
      <Button
        onclick={() => openNewAgent()}
        disabled={!store.canCreate}
        class="flex-1"
        size="sm"
      >
        + New Agent
      </Button>
      <Button
        onclick={() => showPlugins = true}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Manage plugins"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </Button>
    </div>
  </div>
</aside>

{#if showNewAgent}
  <NewAgentDialog onclose={() => showNewAgent = false} defaultRepo={newAgentDefaultRepo} />
{/if}

<PluginPanel open={showPlugins} onclose={() => showPlugins = false} />

<!-- Destroy session confirmation dialog -->
{#if confirmDestroyId}
  {@const session = store.sessions.find(s => s.id === confirmDestroyId)}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmDestroyId = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Destroy Agent?</Dialog.Title>
        <Dialog.Description>
          {#if session?.direct}
            This will stop the agent session on branch
            <span class="text-foreground font-medium">{session?.branch ?? 'unknown'}</span>.
            No files will be deleted.
          {:else}
            This will kill the shell process and remove the worktree for branch
            <span class="text-foreground font-medium">{session?.branch ?? 'unknown'}</span>.
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      {#if !session?.direct}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={deleteBranchOnDestroy} />
          Also delete the branch
        </label>
      {/if}
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
