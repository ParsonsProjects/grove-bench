<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import Sidebar from './components/Sidebar.svelte';
  import ChatPane from './components/ChatPane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';

  async function restoreWorktrees() {
    // For each persisted repo, validate it still exists and recover surviving worktrees
    for (const repo of [...store.repos]) {
      try {
        const valid = await window.groveBench.validateRepo(repo);
        if (!valid) {
          store.removeRepo(repo);
          continue;
        }
        const worktrees = await window.groveBench.listWorktrees(repo);
        for (const wt of worktrees) {
          if (!store.sessions.find((s) => s.id === wt.id)) {
            store.addSession({
              id: wt.id,
              branch: wt.branch,
              repoPath: repo,
              status: 'idle',
            });
          }
        }
      } catch {
        store.removeRepo(repo);
      }
    }
  }

  onMount(() => {
    restoreWorktrees();

    const unsub = window.groveBench.onSessionStatus((sessionId, status) => {
      store.updateStatus(sessionId, status);
    });
    return unsub;
  });
</script>

<PrerequisiteCheck />

<div class="flex h-screen bg-neutral-950 text-neutral-100">
  <Sidebar />

  <!-- Chat area -->
  <main class="flex-1 flex flex-col min-w-0 min-h-0">
    {#if store.sessions.length === 0}
      <div class="flex-1 flex items-center justify-center text-neutral-600">
        <div class="text-center">
          <p class="text-lg mb-2">No active agents</p>
          <p class="text-sm">Add a repository and create an agent to get started.</p>
        </div>
      </div>
    {:else if store.activeSession}
      <!-- Tab bar -->
      <div class="flex items-center bg-neutral-900 border-b border-neutral-800 shrink-0">
        {#each store.sessions as session (session.id)}
          <button
            onclick={() => store.activeSessionId = session.id}
            class="flex items-center gap-2 px-3 py-1.5 text-xs border-r border-neutral-800 last:border-r-0 transition-colors
              {store.activeSessionId === session.id ? 'bg-neutral-950 text-neutral-200' : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300'}"
          >
            <span class="w-1.5 h-1.5 rounded-full {session.status === 'busy' ? 'bg-green-500 animate-pulse' : session.status === 'error' ? 'bg-red-500' : 'bg-neutral-500'} shrink-0"></span>
            {#if store.repos.length > 1}
              <span class="truncate">{store.repoDisplayName(session.repoPath)}</span>
              <span class="text-neutral-600">/</span>
            {/if}
            <span class="truncate">{session.branch}</span>
          </button>
        {/each}
      </div>
      <!-- Active chat -->
      {#each store.sessions as session (session.id)}
        <div class="flex-1 min-h-0" class:hidden={store.activeSessionId !== session.id}>
          <ChatPane sessionId={session.id} />
        </div>
      {/each}
    {/if}
  </main>
</div>

<ErrorToast />
