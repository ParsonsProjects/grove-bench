<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import SettingsPanel from './SettingsPanel.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import SessionContextMenu from './SessionContextMenu.svelte';

  let contextMenu = $state<{ x: number; y: number; sessionId: string } | null>(null);

  function openContextMenu(e: MouseEvent, sessionId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, sessionId };
  }

  function getContextMenuItems(sessionId: string) {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    return [
      { label: 'Rename', icon: 'rename' as const, action: () => startRename(sessionId, sessionLabel(session)) },
      { label: 'Open Folder', icon: 'folder' as const, action: () => window.groveBench.openSessionFolder(sessionId) },
      { label: 'Destroy Agent', icon: 'destroy' as const, action: () => requestDestroy(sessionId), variant: 'destructive' as const },
    ];
  }

  let showNewAgent = $state(false);
  let showSettings = $state(false);
  let showMemory = $state(false);
  let newAgentDefaultRepo = $state('');
  let confirmDestroyId = $state<string | null>(null);
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

    // Mark stopped immediately so the tab closes right away
    store.updateStatus(id, 'stopped');

    try {
      await window.groveBench.destroySession(id, deleteBranch);
      store.removeSession(id);
      gitStatusStore.clear(id);
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

  function sessionLabel(s: { displayName?: string | null; branch: string }): string {
    return s.displayName || s.branch;
  }

  function startRename(sessionId: string, currentLabel: string) {
    renamingSessionId = sessionId;
    renameValue = currentLabel;
    renameError = null;
  }

  async function confirmRename() {
    if (!renamingSessionId) return;
    const newName = renameValue.trim();
    if (!newName) { renamingSessionId = null; return; }

    const session = store.sessions.find(s => s.id === renamingSessionId);
    if (session && newName === sessionLabel(session)) { renamingSessionId = null; return; }

    try {
      await window.groveBench.renameSession(renamingSessionId, newName);
      store.updateDisplayName(renamingSessionId, newName);
      renamingSessionId = null;
      renameError = null;
    } catch (e: any) {
      renameError = e.message || String(e);
    }
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
  }

  const statusColor: Record<string, string> = {
    running: 'bg-primary',
    starting: 'bg-yellow-500',
    installing: 'bg-yellow-500',
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

        <!-- Sessions under this repo -->
        {#each store.sessionsForRepo(repo) as session (session.id)}
            {@const isDestroying = destroying === session.id}
            <button
              onclick={() => !isDestroying && focusSession(session.id)}
              onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); if (!isDestroying) requestDestroy(session.id); } }}
              ondblclick={() => !isDestroying && startRename(session.id, sessionLabel(session))}
              oncontextmenu={(e) => { if (isDestroying) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
              disabled={isDestroying}
              title={sessionLabel(session)}
              class="w-full flex items-center justify-between pl-4 pr-2 py-1.5 text-left group/session transition-colors
                {isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
            >
              <div class="flex items-center gap-2 min-w-0">
                {#if destroying === session.id}
                  <span class="w-2 h-2 bg-muted-foreground animate-pulse shrink-0"></span>
                {:else if session.status === 'error'}
                  <span class="w-2 h-2 bg-red-500 shrink-0"></span>
                {:else if session.status === 'starting' || session.status === 'installing'}
                  <span class="w-2 h-2 bg-yellow-500 animate-pulse shrink-0"></span>
                {:else if messageStore.getIsRunning(session.id)}
                  <span class="w-2 h-2 bg-primary animate-pulse shrink-0"></span>
                {:else if getSessionHasPending(session.id)}
                  <span class="w-2 h-2 bg-amber-500 animate-pulse shrink-0"></span>
                {:else if session.status === 'stopped'}
                  <span class="w-2 h-2 bg-neutral-500 shrink-0"></span>
                {:else}
                  <span class="w-2 h-2 bg-green-500 shrink-0"></span>
                {/if}
                {#if session.direct}
                  <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Direct (no worktree)"><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z"/><path d="M12 8h6v2h-6z"/></svg>
                {:else}
                  <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Worktree"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
                {/if}
                <span class="text-sm truncate">{sessionLabel(session)}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <span
                  role="button"
                  tabindex="-1"
                  onclick={(e) => { e.stopPropagation(); if (!isDestroying) requestDestroy(session.id); }}
                  onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !isDestroying) requestDestroy(session.id); }}
                  class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 transition-colors shrink-0
                    {isDestroying ? 'hidden' : 'hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 cursor-pointer'}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </span>
              </div>
            </button>
        {/each}

        {#if store.sessionsForRepo(repo).length === 0}
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
        + Agent
      </Button>
      <Button
        onclick={() => showMemory = true}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Project Memory"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-1.5 0-3 .8-4 2s-1.5 3-2.5 3.5C4 8.5 3 10 3 12c0 1.5.5 3 1.5 4s1 2.5.5 3.5c.5 1.5 2 2.5 3.5 2.5H12"/><path d="M12 2c1.5 0 3 .8 4 2s1.5 2.5 2.5 3c1.5 1 2 2.5 2 4"/><path d="M12 2v20"/><path d="M12 8h5"/><path d="M12 14h4"/><circle cx="17.5" cy="8" r="1.2" fill="currentColor"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor"/></svg>
      </Button>
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

<SettingsPanel open={showSettings} onclose={() => showSettings = false} />
<MemoryPanel open={showMemory} onclose={() => showMemory = false} />

{#if contextMenu}
  <SessionContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems(contextMenu.sessionId)}
    onclose={() => contextMenu = null}
  />
{/if}

<!-- Rename dialog -->
{#if renamingSessionId}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) renamingSessionId = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Rename Agent</Dialog.Title>
      </Dialog.Header>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={renameValue}
        onkeydown={handleRenameKeydown}
        class="w-full text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
        autofocus
      />
      {#if renameError}
        <span class="text-xs text-destructive">{renameError}</span>
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => renamingSessionId = null}>Cancel</Button>
        <Button onclick={confirmRename}>Rename</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

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
