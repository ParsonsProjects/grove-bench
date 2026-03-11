<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './stores/sessions.svelte.js';
  import { messageStore } from './stores/messages.svelte.js';
  import Sidebar from './components/Sidebar.svelte';
  import WorkspacePane from './components/WorkspacePane.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import PrerequisiteCheck from './components/PrerequisiteCheck.svelte';

  async function restoreWorktrees() {
    const runningSessions = await window.groveBench.listSessions();
    const runningIds = new Set(runningSessions.filter((s) => s.status === 'running').map((s) => s.id));

    for (const repo of [...store.repos]) {
      try {
        const valid = await window.groveBench.validateRepo(repo);
        if (!valid) {
          store.removeRepo(repo);
          continue;
        }
        const worktrees = await window.groveBench.listWorktrees(repo);
        for (const wt of worktrees) {
          if (store.sessions.find((s) => s.id === wt.id)) continue;

          const isRunning = runningIds.has(wt.id);
          store.addSession({
            id: wt.id,
            branch: wt.branch,
            repoPath: repo,
            status: isRunning ? 'running' : 'stopped',
          });

          if (isRunning) {
            window.groveBench.resumeSession(wt.id, repo).then(async () => {
              try {
                const history = await window.groveBench.getEventHistory(wt.id);
                for (const event of history) {
                  messageStore.ingestEvent(wt.id, event);
                }
                if (history.length > 0) {
                  const last = history[history.length - 1];
                  if (last.type === 'result' || last.type === 'process_exit') {
                    messageStore.isRunning[wt.id] = false;
                  }
                }
              } catch {
                messageStore.ingestEvent(wt.id, {
                  type: 'status',
                  message: 'Session reconnected — restart app to enable message history',
                });
              }
              messageStore.subscribe(wt.id);
            }).catch((e: any) => {
              store.setError(e.message || String(e));
            });
          }
        }
      } catch {
        store.removeRepo(repo);
      }
    }
  }

  let resumingId: string | null = null;

  $effect(() => {
    const session = store.activeSession;
    if (!session || session.status !== 'stopped' || resumingId === session.id) return;

    resumingId = session.id;
    window.groveBench.resumeSession(session.id, session.repoPath).then((result) => {
      store.updateStatus(result.id, 'running');
      messageStore.subscribe(result.id);
    }).catch((e: any) => {
      store.setError(e.message || String(e));
    }).finally(() => {
      resumingId = null;
    });
  });

  async function closeTab(id: string) {
    try {
      await window.groveBench.stopSession(id);
    } catch { /* session may already be dead */ }
    store.updateStatus(id, 'stopped');
    if (store.activeSessionId === id) {
      const next = store.sessions.find((s) => s.id !== id && s.status === 'running');
      store.activeSessionId = next?.id ?? null;
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

<div class="flex h-screen bg-background text-foreground font-mono">
  <Sidebar />

  <main class="flex-1 flex flex-col min-w-0 min-h-0">
    {#if store.sessions.length === 0}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <p class="text-sm mb-2">No active agents</p>
          <p class="text-xs">Add a repository and create an agent to get started.</p>
        </div>
      </div>
    {:else if !store.activeSession}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <p class="text-sm mb-2">No open sessions</p>
          <p class="text-xs">Click a session in the sidebar to open it.</p>
        </div>
      </div>
    {:else}
      <!-- Tab bar -->
      {@const openSessions = store.sessions.filter((s) => s.status === 'running')}
      {#if openSessions.length > 0}
        <div class="flex items-center bg-card border-b border-border shrink-0">
          {#each openSessions as session (session.id)}
            {@const isActive = store.activeSessionId === session.id}
            {@const running = messageStore.getIsRunning(session.id)}
            <button
              onclick={() => store.activeSessionId = session.id}
              class="flex items-center gap-2 px-3 py-1.5 text-xs border-r border-border last:border-r-0 transition-colors group/tab
                {isActive ? 'bg-background text-foreground/80 border-b-2 border-b-primary' : 'bg-card text-muted-foreground hover:text-foreground border-b-2 border-b-transparent'}"
            >
              <span class="w-1.5 h-1.5 shrink-0 {running ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
              {#if store.repos.length > 1}
                <span class="truncate">{store.repoDisplayName(session.repoPath)}</span>
                <span class="text-muted-foreground/40">/</span>
              {/if}
              <span class="truncate">{session.branch}</span>
              <span
                role="button"
                tabindex="-1"
                onclick={(e) => { e.stopPropagation(); closeTab(session.id); }}
                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); closeTab(session.id); } }}
                class="ml-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity cursor-pointer"
              >&times;</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Active session -->
      {#each store.sessions as session (session.id)}
        <div class="flex-1 min-h-0" class:hidden={store.activeSessionId !== session.id}>
          {#if session.status === 'running'}
            <WorkspacePane sessionId={session.id} />
          {:else}
            <div class="flex items-center justify-center h-full text-muted-foreground">
              <div class="w-5 h-5 border-2 border-border border-t-transparent animate-spin"></div>
              <span class="ml-3 text-sm">Starting agent...</span>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </main>
</div>

<ErrorToast />
