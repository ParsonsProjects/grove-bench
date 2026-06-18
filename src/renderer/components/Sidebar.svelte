<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { checkpointStore } from '../stores/checkpoints.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { trackEvent } from '../lib/analytics.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import SettingsPanel from './SettingsPanel.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import SessionContextMenu from './SessionContextMenu.svelte';
  import { formatAge } from '../lib/format-age.js';
  import { isRepoCollapsed } from '../lib/repo-collapse.js';
  import { sortSessions, defaultDirFor, DEFAULT_SORT } from '../lib/session-sort.js';
  import type { SessionSortState } from '../../shared/types.js';
  import { onMount } from 'svelte';

  // Per-repo accordion collapse state, persisted via app-state. An explicit
  // entry wins; otherwise repos default to collapsed (see isRepoCollapsed).
  // Loaded on mount; the empty map renders the correct default immediately, so
  // there's no flash of expanded content.
  let collapsedRepos = $state<Record<string, boolean>>({});

  // Session ordering (name/age, asc/desc), also persisted via app-state.
  let sort = $state<SessionSortState>({ ...DEFAULT_SORT });

  onMount(async () => {
    [collapsedRepos, sort] = await Promise.all([
      window.groveBench.getCollapsedRepos(),
      window.groveBench.getSessionSort(),
    ]);
  });

  function toggleRepoCollapsed(repo: string) {
    const current = isRepoCollapsed(collapsedRepos, repo);
    collapsedRepos = { ...collapsedRepos, [repo]: !current };
    window.groveBench.setCollapsedRepos($state.snapshot(collapsedRepos));
  }

  /** Click a sort key: flip its direction if already active, else switch to it
   *  with that key's natural default direction. */
  function setSort(key: SessionSortState['key']) {
    sort = key === sort.key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: defaultDirFor(key) };
    window.groveBench.setSessionSort($state.snapshot(sort));
  }

  let contextMenu = $state<{ x: number; y: number; sessionId: string } | null>(null);

  function openContextMenu(e: MouseEvent, sessionId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, sessionId };
  }

  interface MenuItem {
    label: string;
    icon: 'add' | 'rename' | 'folder' | 'stop' | 'destroy';
    action: () => void;
    variant?: 'destructive';
    separator?: boolean;
  }

  function getContextMenuItems(sessionId: string): MenuItem[] {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    const items: MenuItem[] = [
      { label: 'New Session', icon: 'add', action: () => store.createAttachedSession(session.id, session.repoPath) },
      { label: 'Rename', icon: 'rename', action: () => startRename(sessionId, sessionLabel(session)) },
      { label: 'Open Folder', icon: 'folder', action: () => window.groveBench.openSessionFolder(sessionId) },
    ];
    // Stop disconnects a live session (keeps it resumable); not shown for already-stopped ones.
    if (session.status !== 'stopped') {
      items.push({ label: 'Stop', icon: 'stop', action: () => stopSession(sessionId) });
    }
    items.push({ label: 'Destroy Agent', icon: 'destroy', action: () => requestDestroy(sessionId), variant: 'destructive', separator: true });
    return items;
  }

  let showNewAgent = $state(false);
  let showSettings = $state(false);
  let showMemory = $state(false);
  let newAgentDefaultRepo = $state('');
  let confirmDestroyId = $state<string | null>(null);
  let destroying = $state<Set<string>>(new Set());
  let confirmRemoveRepo = $state<string | null>(null);
  let deleteBranchOnDestroy = $state(false);
  let renamingSessionId = $state<string | null>(null);
  let renameValue = $state('');
  let renameError = $state<string | null>(null);

  function focusSession(id: string) {
    store.activeSessionId = id;
    store.clearNeedsAttention(id);
  }

  /** Stop a session non-destructively: tears down the connection but keeps the
   *  worktree so it can be resumed by clicking it (auto-resume in App.svelte). */
  async function stopSession(id: string) {
    store.pushRecentlyClosed(id);
    if (store.activeSessionId === id) {
      const next = store.sessions.find((s) => s.id !== id && s.status === 'running');
      store.activeSessionId = next?.id ?? null;
    }
    store.updateStatus(id, 'stopped');
    try {
      await window.groveBench.stopSession(id);
    } catch { /* session may already be dead */ }
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
    destroying = new Set([...destroying, id]);

    // Mark stopped immediately so the tab closes right away
    store.updateStatus(id, 'stopped');

    // Deactivate so the auto-resume $effect doesn't bring the tab back
    if (store.activeSessionId === id) {
      const next = store.sessions.find((s) => s.id !== id && s.status === 'running');
      store.activeSessionId = next?.id ?? null;
    }

    try {
      await window.groveBench.destroySession(id, deleteBranch);
      trackEvent('session_destroyed');
      store.removeSession(id);
      gitStatusStore.clear(id);
      // Tear down all per-session renderer state so nothing leaks for the
      // lifetime of the app (messages + IPC listener, checkpoints, terminal).
      messageStore.destroySession(id);
      checkpointStore.clear(id);
      terminalStore.destroySession(id);
    } catch (e: any) {
      store.setError(e.message || String(e));
    } finally {
      const next = new Set(destroying);
      next.delete(id);
      destroying = next;
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

  /** '#n ' prefix when multiple sessions in the repo share this branch, so
   *  same-branch sessions (e.g. several agents on one worktree) stay
   *  distinguishable. Mirrors the old tab bar's numbering. */
  function branchIndex(s: { id: string; repoPath: string; branch: string }): string {
    const siblings = store.sessionsForRepo(s.repoPath).filter((x) => x.branch === s.branch);
    if (siblings.length <= 1) return '';
    const idx = siblings.findIndex((x) => x.id === s.id);
    return `#${idx + 1} `;
  }

  /** Visible row label: a user/auto name when set, else the branch with a '#n'
   *  prefix when shared. Kept separate from sessionLabel so rename prefill and
   *  no-op detection use the plain name without the index. */
  function sessionRowLabel(s: { id: string; repoPath: string; displayName?: string | null; branch: string }): string {
    return s.displayName || (branchIndex(s) + s.branch);
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

  function getSessionHasPending(sessionId: string): boolean {
    return messageStore.hasPendingPermission(sessionId);
  }

  /** Live sessions (anything not stopped), ordered by the active sort.
   *  This is the always-visible "working set" that replaces the old tab bar. */
  let activeSessions = $derived(
    sortSessions(store.sessions.filter((s) => s.status !== 'stopped'), sort),
  );

  /** Aggregate counts for the ACTIVE header. A waiting session takes priority
   *  over working so the categories are mutually exclusive (no double-count). */
  let activeStats = $derived.by(() => {
    let working = 0, idle = 0, waiting = 0;
    for (const s of activeSessions) {
      if (messageStore.hasPendingPermission(s.id)) waiting++;
      else if (messageStore.getIsRunning(s.id)) working++;
      else idle++;
    }
    return { working, idle, waiting };
  });

  let stoppedCount = $derived(store.sessions.filter((s) => s.status === 'stopped').length);

  /** All sessions for a repo, grouped by branch (for the INACTIVE tree), with
   *  each group's sessions ordered by the active sort. Active (non-stopped)
   *  sessions are kept here too — the rows render greyed-out and non-clickable
   *  (they remain fully interactive in the ACTIVE list above). */
  function getInactiveBranchGroups(repo: string): [string, typeof store.sessions][] {
    const groups: Record<string, typeof store.sessions> = {};
    for (const s of store.sessionsForRepo(repo)) {
      const key = s.branch || 'main';
      (groups[key] ??= []).push(s);
    }
    return Object.entries(groups).map(
      ([branch, sessions]): [string, typeof store.sessions] => [branch, sortSessions(sessions, sort)],
    );
  }
</script>

<aside class="w-60 border-r border-sidebar-border flex flex-col bg-sidebar shrink-0">
  <!-- Reusable session row, shared by the Active list and the Inactive tree -->
  {#snippet sessionRow(session: (typeof store.sessions)[number], showRepoPrefix: boolean, labelOverride: string | null, greyedOut: boolean = false)}
    {@const isDestroying = destroying.has(session.id)}
    {@const isStopped = session.status === 'stopped'}
    {@const repoColor = getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors)}
    {@const ts = session.lastActiveAt ?? session.createdAt}
    <button
      onclick={() => { if (!isDestroying && !greyedOut) focusSession(session.id); }}
      oncontextmenu={(e) => { if (isDestroying || greyedOut) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
      disabled={isDestroying || greyedOut}
      title={greyedOut ? `${sessionRowLabel(session)} — active; manage it in the Active list above` : sessionRowLabel(session)}
      class="w-full flex items-center justify-between pl-4 pr-2 py-1.5 text-left group/session transition-colors
        {greyedOut ? 'cursor-not-allowed' : isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
    >
      <div class="flex items-center gap-2 min-w-0">
        {#if isDestroying}
          <span class="w-2 h-2 bg-muted-foreground animate-pulse shrink-0"></span>
        {:else if session.status === 'error'}
          <span class="w-2 h-2 bg-red-500 shrink-0"></span>
        {:else if session.status === 'starting' || session.status === 'installing'}
          <span class="w-2 h-2 bg-yellow-500 animate-pulse shrink-0"></span>
        {:else if getSessionHasPending(session.id)}
          <span class="w-2 h-2 bg-amber-500 animate-pulse shrink-0"></span>
        {:else if messageStore.getIsRunning(session.id)}
          <span class="w-2 h-2 bg-primary animate-pulse shrink-0"></span>
        {:else if store.needsAttention[session.id]}
          <span class="w-2 h-2 bg-green-400 shrink-0 needs-attention-flash"></span>
        {:else if session.status === 'stopped'}
          <span class="w-2 h-2 bg-neutral-500 shrink-0"></span>
        {:else}
          <span class="w-2 h-2 bg-green-500 shrink-0"></span>
        {/if}
        {#if session.direct}
          <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground {greyedOut ? 'opacity-40' : ''}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Direct (no worktree)"><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z"/><path d="M12 8h6v2h-6z"/></svg>
        {:else}
          <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground {greyedOut ? 'opacity-40' : ''}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" title="Worktree"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
        {/if}
        <span class="text-sm truncate min-w-0 {greyedOut ? 'opacity-40' : ''}">
          {#if showRepoPrefix}{#if repoColor}<span class="inline-block w-1.5 h-1.5 align-middle mr-1" style="background-color: {repoColor}"></span>{/if}<span class="text-muted-foreground/70">{store.repoDisplayName(session.repoPath)}</span><span class="text-muted-foreground/40"> / </span>{/if}{labelOverride ?? sessionRowLabel(session)}
        </span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        {#if ts}
          <span class="text-[10px] text-muted-foreground/50 {greyedOut ? 'opacity-40' : 'group-hover/session:hidden'}" title="{session.lastActiveAt ? 'Last active' : 'Created'} {new Date(ts).toLocaleString()}">{formatAge(ts)}</span>
        {/if}
        {#if greyedOut}
          <!-- Active session shown here for context only; manage it in the Active list. -->
        {:else if isStopped}
          <!-- Inactive session: destroy (removes the worktree). -->
          <span
            role="button"
            tabindex="-1"
            title="Destroy agent"
            onclick={(e) => { e.stopPropagation(); if (!isDestroying) requestDestroy(session.id); }}
            onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !isDestroying) requestDestroy(session.id); }}
            class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 transition-colors shrink-0
              {isDestroying ? 'hidden' : 'hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 cursor-pointer'}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </span>
        {:else}
          <!-- Active session: stop (disconnect but keep it resumable). -->
          <span
            role="button"
            tabindex="-1"
            title="Stop agent"
            onclick={(e) => { e.stopPropagation(); if (!isDestroying) stopSession(session.id); }}
            onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !isDestroying) stopSession(session.id); }}
            class="w-5 h-5 flex items-center justify-center text-muted-foreground/40 transition-colors shrink-0
              {isDestroying ? 'hidden' : 'hover:text-foreground hover:bg-sidebar-accent opacity-0 group-hover/session:opacity-100 cursor-pointer'}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>
          </span>
        {/if}
      </div>
    </button>
  {/snippet}

  <!-- Sort toggle, shared by the Active list and the Inactive tree -->
  {#snippet sortButton(key: SessionSortState['key'], label: string)}
    {@const active = sort.key === key}
    <button
      type="button"
      onclick={() => setSort(key)}
      class="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors
        {active ? 'text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground'}"
      title="Sort by {label.toLowerCase()}{active ? (sort.dir === 'asc' ? ' (ascending)' : ' (descending)') : ''}"
    >
      {label}
      {#if active}
        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" style={sort.dir === 'asc' ? 'transform: rotate(180deg)' : ''}><path d="m6 9 6 6 6-6"/></svg>
      {/if}
    </button>
  {/snippet}

  <div class="flex-1 overflow-auto px-3 py-3">
    <!-- Sort control (applies to active list + inactive sessions) -->
    <div class="flex items-center mb-2 px-1">
      <span class="text-[10px] text-muted-foreground/40 uppercase tracking-wide mr-auto">Sort</span>
      {@render sortButton('name', 'Name')}
      {@render sortButton('age', 'Age')}
    </div>

    <!-- ACTIVE: the live working set, always visible at the top -->
    <div class="flex items-center justify-between mb-1 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Active</span>
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground/60">
        {#if activeStats.working}
          <span class="flex items-center gap-0.5" title="{activeStats.working} working"><span class="w-1.5 h-1.5 bg-primary"></span>{activeStats.working}</span>
        {/if}
        {#if activeStats.idle}
          <span class="flex items-center gap-0.5" title="{activeStats.idle} idle"><span class="w-1.5 h-1.5 bg-green-500"></span>{activeStats.idle}</span>
        {/if}
        {#if activeStats.waiting}
          <span class="flex items-center gap-0.5" title="{activeStats.waiting} waiting for input"><span class="w-1.5 h-1.5 bg-amber-500"></span>{activeStats.waiting}</span>
        {/if}
      </div>
    </div>

    {#each activeSessions as session (session.id)}
      {@render sessionRow(session, true, null)}
    {/each}
    {#if activeSessions.length === 0}
      <p class="text-xs text-muted-foreground/50 pl-4 py-1">No active agents</p>
    {/if}

    <!-- INACTIVE: stopped sessions grouped by repo; hosts repo management -->
    <div class="flex items-center justify-between mt-5 mb-2 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Inactive</span>
      {#if stoppedCount}
        <span class="text-[10px] text-muted-foreground/50">{stoppedCount} stopped</span>
      {/if}
    </div>

    {#each store.repos as repo (repo)}
      {@const canRemove = store.canRemoveRepo(repo)}
      {@const repoColor = getRepoColor(store.repos, repo, settingsStore.current.repoColors)}
      {@const inactiveGroups = getInactiveBranchGroups(repo)}
      {@const inactiveCount = inactiveGroups.reduce((n, [, s]) => n + s.length, 0)}
      {@const collapsed = isRepoCollapsed(collapsedRepos, repo)}
      <div class="mb-3">
        <!-- Repo header (click to collapse/expand the repo's inactive tree) -->
        <div class="flex items-center justify-between group px-1 py-1">
          <button
            type="button"
            onclick={() => toggleRepoCollapsed(repo)}
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-foreground transition-colors"
            title={collapsed ? 'Expand repository' : 'Collapse repository'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted-foreground/60 transition-transform" style={collapsed ? 'transform: rotate(-90deg)' : ''}><path d="m6 9 6 6 6-6"/></svg>
            {#if repoColor}
              <span class="w-2 h-2 shrink-0" style="background-color: {repoColor}"></span>
            {/if}
            <span class="text-xs font-medium text-muted-foreground truncate" title={repo}>
              {store.repoDisplayName(repo)}
            </span>
            {#if inactiveCount}
              <span class="text-xs text-muted-foreground/40 shrink-0">{inactiveCount}</span>
            {/if}
          </button>
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

        <!-- Stopped sessions grouped by branch -->
        {#if !collapsed}
          {#each inactiveGroups as [branch, sessions] (branch)}
            {#if sessions.length === 1}
              {@render sessionRow(sessions[0], false, null, sessions[0].status !== 'stopped')}
            {:else}
              <div class="pl-3 mt-0.5">
                <div class="flex items-center gap-1.5 px-1 py-0.5 text-xs text-muted-foreground/70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  <span class="truncate" title={branch}>{branch}</span>
                  <span class="text-muted-foreground/40">({sessions.length})</span>
                </div>
                {#each sessions as session, i (session.id)}
                  {@render sessionRow(session, false, session.displayName || `session ${i + 1}`, session.status !== 'stopped')}
                {/each}
              </div>
            {/if}
          {/each}

          {#if inactiveGroups.length === 0}
            <p class="text-xs text-muted-foreground/40 pl-4 py-1">No inactive agents</p>
          {/if}
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

<style>
  /* Green flash on a session row when its agent finished a turn while not focused */
  .needs-attention-flash {
    animation: needs-attention-flash 0.8s ease-in-out infinite;
  }
  @keyframes needs-attention-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
</style>
