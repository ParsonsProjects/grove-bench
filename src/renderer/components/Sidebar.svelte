<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import OrchestrationDialog from './OrchestrationDialog.svelte';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import SettingsPanel from './SettingsPanel.svelte';

  let showNewAgent = $state(false);
  let showOrchestrate = $state(false);
  let orchDefaultRepo = $state('');
  let showSettings = $state(false);
  let newAgentDefaultRepo = $state('');
  let showCreateDropdown = $state(false);
  let confirmDestroyId = $state<string | null>(null);
  let confirmRemoveOrch = $state<string | null>(null);
  let removingOrch = $state<string | null>(null);
  let destroying = $state<string | null>(null);
  let confirmRemoveRepo = $state<string | null>(null);
  let deleteBranchOnDestroy = $state(false);
  let renamingSessionId = $state<string | null>(null);
  let renameValue = $state('');
  let renameError = $state<string | null>(null);

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

  function startRename(sessionId: string, currentBranch: string) {
    renamingSessionId = sessionId;
    renameValue = currentBranch;
    renameError = null;
  }

  async function confirmRename() {
    if (!renamingSessionId) return;
    const newName = renameValue.trim();
    if (!newName) { cancelRename(); return; }

    const session = store.sessions.find(s => s.id === renamingSessionId);
    if (session && newName === session.branch) { cancelRename(); return; }

    try {
      const result = await window.groveBench.renameBranch(renamingSessionId, newName);
      store.updateBranch(renamingSessionId, result.branch);
      renamingSessionId = null;
      renameError = null;
    } catch (e: any) {
      renameError = e.message || String(e);
    }
  }

  function cancelRename() {
    renamingSessionId = null;
    renameValue = '';
    renameError = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  }

  const statusColor: Record<string, string> = {
    running: 'bg-primary',
    starting: 'bg-yellow-500',
    stopped: 'bg-neutral-500',
    error: 'bg-red-500',
  };

  function getSessionHasPending(sessionId: string): boolean {
    return messageStore.getMessages(sessionId).some((m) => m.kind === 'permission' && !m.resolved);
  }
</script>

<aside class="w-60 border-r border-sidebar-border flex flex-col bg-sidebar shrink-0">
  <!-- Repo-grouped sessions -->
  <div class="flex-1 overflow-auto px-3 py-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Repositories</span>
      <span class="text-xs text-muted-foreground/60">{store.sessions.filter(s => s.status === 'running').length}/{store.count} running</span>
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

        <!-- Sessions under this repo (top-level only) -->
        {#each store.topLevelSessionsForRepo(repo) as session (session.id)}
          {@const children = store.childSessions(session.id)}
          {@const orchJob = session.orchJobId ? orchStore.jobs.find(j => j.id === session.orchJobId) : null}
          {#if renamingSessionId === session.id}
            <div class="pl-4 pr-2 py-1 flex flex-col gap-1">
              <input
                type="text"
                bind:value={renameValue}
                onkeydown={handleRenameKeydown}
                onblur={cancelRename}
                class="w-full text-sm bg-card border border-primary px-1.5 py-0.5 text-foreground focus:outline-none"
                autofocus
              />
              {#if renameError}
                <span class="text-[10px] text-destructive">{renameError}</span>
              {/if}
            </div>
          {:else}
            <button
              onclick={() => focusSession(session.id)}
              ondblclick={() => { if (!session.direct && !session.orchJobId) startRename(session.id, session.branch); }}
              class="w-full flex items-center justify-between pl-4 pr-2 py-1.5 text-left group/session transition-colors
                {store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
            >
              <div class="flex items-center gap-2 min-w-0">
                {#if destroying === session.id}
                  <span class="w-2 h-2 bg-muted-foreground animate-pulse shrink-0"></span>
                {:else if session.status === 'error'}
                  <span class="w-2 h-2 bg-red-500 shrink-0"></span>
                {:else if session.status === 'starting'}
                  <span class="w-2 h-2 bg-yellow-500 animate-pulse shrink-0"></span>
                {:else if messageStore.getIsRunning(session.id)}
                  <span class="w-2 h-2 bg-primary animate-pulse shrink-0"></span>
                {:else if getSessionHasPending(session.id)}
                  <span class="w-1.5 h-1.5 bg-amber-500 animate-pulse shrink-0"></span>
                {:else if session.status === 'stopped'}
                  <span class="w-2 h-2 bg-neutral-500 shrink-0"></span>
                {:else}
                  <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                {/if}
                {#if orchJob}
                  <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/><path d="m4.2 4.2 2.8 2.8"/><path d="m17 17 2.8 2.8"/><path d="m4.2 19.8 2.8-2.8"/><path d="m17 7 2.8-2.8"/></svg>
                {:else if session.direct}
                  <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Direct (no worktree)"><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z"/><path d="M12 8h6v2h-6z"/></svg>
                {:else}
                  <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Worktree — double-click to rename"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
                {/if}
                <span class="text-sm truncate">{session.branch}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                {#if orchJob && orchJob.tasks.length > 0}
                  <span class="text-[10px] text-muted-foreground">{orchJob.tasks.filter(t => t.status === 'completed').length}/{orchJob.tasks.length}</span>
                {/if}
                <span
                  role="button"
                  tabindex="-1"
                  onclick={(e) => { e.stopPropagation(); orchJob ? (confirmRemoveOrch = orchJob.id) : requestDestroy(session.id); }}
                  onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') orchJob ? (confirmRemoveOrch = orchJob.id) : requestDestroy(session.id); }}
                  class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 cursor-pointer transition-colors shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </span>
              </div>
            </button>
          {/if}

          <!-- Nested child sessions (orch subtasks) -->
          {#each children as child (child.id)}
            <button
              onclick={() => focusSession(child.id)}
              class="w-full flex items-center justify-between pl-8 pr-2 py-1 text-left group/child transition-colors
                {store.activeSessionId === child.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
            >
              <div class="flex items-center gap-2 min-w-0">
                {#if child.status === 'error'}
                  <span class="w-1.5 h-1.5 bg-red-500 shrink-0"></span>
                {:else if child.status === 'starting'}
                  <span class="w-1.5 h-1.5 bg-yellow-500 animate-pulse shrink-0"></span>
                {:else if messageStore.getIsRunning(child.id)}
                  <span class="w-1.5 h-1.5 bg-primary animate-pulse shrink-0"></span>
                {:else if getSessionHasPending(child.id)}
                  <span class="w-1.5 h-1.5 bg-amber-500 animate-pulse shrink-0"></span>
                {:else if child.status === 'stopped'}
                  <span class="w-1.5 h-1.5 bg-neutral-500 shrink-0"></span>
                {:else}
                  <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                {/if}
                <svg class="w-3 h-3 shrink-0 text-muted-foreground/60" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
                <span class="text-xs truncate text-muted-foreground">{child.branch}</span>
              </div>
              <span
                role="button"
                tabindex="-1"
                onclick={(e) => { e.stopPropagation(); child.parentSessionId?.startsWith('plan_') ? store.removeSession(child.id) : requestDestroy(child.id); }}
                onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (child.parentSessionId?.startsWith('plan_') ? store.removeSession(child.id) : requestDestroy(child.id)); }}
                class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/child:opacity-100 cursor-pointer transition-colors shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </span>
            </button>
          {/each}
        {/each}

        {#if store.topLevelSessionsForRepo(repo).length === 0}
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
      <div class="flex flex-1 relative">
        <Button
          onclick={() => openNewAgent()}
          disabled={!store.canCreate}
          class="flex-1 rounded-r-none border-r-0"
          size="sm"
        >
          + Agent
        </Button>
        <Button
          onclick={() => showCreateDropdown = !showCreateDropdown}
          disabled={!store.canCreate}
          class="rounded-l-none px-1.5 border-l border-l-primary-foreground/20"
          size="sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M3 5h10L8 11z"/></svg>
        </Button>
        {#if showCreateDropdown}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => showCreateDropdown = false}
            onkeydown={(e) => e.key === 'Escape' && (showCreateDropdown = false)}
          ></div>
          <div class="absolute bottom-full left-0 mb-1 w-full bg-popover border border-border rounded-md shadow-lg z-50 py-1">
            <button
              class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              onclick={() => { orchDefaultRepo = store.repos[0] || ''; showOrchestrate = true; showCreateDropdown = false; }}
            >
              Orchestrate
            </button>
          </div>
        {/if}
      </div>
      <Button
        onclick={() => showSettings = true}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </Button>
    </div>
  </div>
</aside>

{#if showNewAgent}
  <NewAgentDialog onclose={() => showNewAgent = false} defaultRepo={newAgentDefaultRepo} />
{/if}

{#if showOrchestrate}
  <OrchestrationDialog onclose={() => showOrchestrate = false} defaultRepo={orchDefaultRepo} />
{/if}

<SettingsPanel open={showSettings} onclose={() => showSettings = false} />

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

<!-- Remove orchestration confirmation dialog -->
{#if confirmRemoveOrch}
  {@const orchJobToRemove = orchStore.jobs.find(j => j.id === confirmRemoveOrch)}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmRemoveOrch = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Remove Orchestration?</Dialog.Title>
        <Dialog.Description>
          This will remove the orchestration job
          {#if orchJobToRemove}
            "<span class="text-foreground font-medium">{orchJobToRemove.goal.slice(0, 50)}</span>"
          {/if}
          and destroy all its agent sessions and worktrees.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmRemoveOrch = null}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={removingOrch === confirmRemoveOrch}
          onclick={async () => {
            const id = confirmRemoveOrch;
            if (!id) return;
            removingOrch = id;
            try {
              await window.groveBench.removeOrchJob(id);
              // Remove the orchestrator session and its children
              const orchSession = store.sessions.find(s => s.orchJobId === id);
              if (orchSession) {
                // Remove child sessions
                const children = store.childSessions(orchSession.id);
                for (const child of children) {
                  store.removeSession(child.id);
                }
                store.removeSession(orchSession.id);
              }
              orchStore.removeJob(id);
            } catch { /* best effort */ }
            removingOrch = null;
            confirmRemoveOrch = null;
          }}
        >
          {removingOrch === confirmRemoveOrch ? 'Removing...' : 'Remove'}
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
