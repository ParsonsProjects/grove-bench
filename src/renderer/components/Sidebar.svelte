<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { checkpointStore } from '../stores/checkpoints.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { trackEvent } from '../lib/analytics.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
  import NewAgentDialog from './NewAgentDialog.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import SettingsPanel from './SettingsPanel.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import { memoryStore } from '../stores/memory.svelte.js';
  import SessionContextMenu from './SessionContextMenu.svelte';
  import { formatAge } from '../lib/format-age.js';
  import { isRepoCollapsed } from '../lib/repo-collapse.js';
  import { sortSessions, defaultDirFor, DEFAULT_SORT } from '../lib/session-sort.js';
  import { triageState, triageCounts, matchesTriageFilter, TRIAGE_FILTERS, TRIAGE_FILTER_LABELS, type TriageFilter, type TriageState } from '../lib/session-triage.js';
  import { sessionSubtitle, pendingPermissionTool, lastTextSnippet, firstPromptSnippet, type SessionSubtitle } from '../lib/session-subtitle.js';
  import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
  import { prStateFlag, isPrMerged } from '../lib/pr-state.js';
  import type { SessionSortState, PrInfo } from '../../shared/types.js';
  import { onMount, untrack } from 'svelte';

  // Per-repo accordion collapse state, persisted via app-state. An explicit
  // entry wins; otherwise repos default to collapsed (see isRepoCollapsed).
  // Loaded on mount; the empty map renders the correct default immediately, so
  // there's no flash of expanded content.
  let collapsedRepos = $state<Record<string, boolean>>({});

  // Session ordering (name/age, asc/desc), also persisted via app-state.
  let sort = $state<SessionSortState>({ ...DEFAULT_SORT });

  // User-resizable sidebar width (px), persisted via app-state.
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 300;
  // Below this width the "+ Repository" / "+ Conversation" labels no longer
  // fit side by side, so the bottom buttons collapse to icons.
  const SIDEBAR_COMPACT_BELOW = 280;
  let sidebarWidth = $state(SIDEBAR_DEFAULT);
  let compact = $derived(sidebarWidth < SIDEBAR_COMPACT_BELOW);
  let resizing = $state(false);

  onMount(async () => {
    let savedWidth: number | null;
    [collapsedRepos, sort, savedWidth] = await Promise.all([
      window.groveBench.getCollapsedRepos(),
      window.groveBench.getSessionSort(),
      window.groveBench.getSidebarWidth(),
    ]);
    if (savedWidth != null) {
      sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, savedWidth));
    }
  });

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    resizing = true;
    const onMove = (ev: PointerEvent) => {
      sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)));
    };
    const onUp = () => {
      resizing = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.groveBench.setSidebarWidth(sidebarWidth);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Fetch conversation previews for sessions whose messages aren't loaded in the
  // renderer (stopped sessions), so their rows still show what the agent was about.
  $effect(() => {
    const unloaded = store.sessions
      .filter((s) => messageStore.getMessages(s.id).length === 0)
      .map((s) => s.id);
    if (unloaded.length > 0) sessionPreviewStore.ensure(unloaded);
  });

  /** Context line under a session row: waiting-reason > live activity > last/first message. */
  function rowSubtitle(session: { id: string }): SessionSubtitle | null {
    const msgs = messageStore.getMessages(session.id);
    const loaded = msgs.length > 0;
    const preview = sessionPreviewStore.get(session.id);
    return sessionSubtitle({
      isRunning: messageStore.getIsRunning(session.id),
      activity: messageStore.getActivity(session.id),
      pendingTool: loaded ? pendingPermissionTool(msgs) : null,
      lastText: (loaded ? lastTextSnippet(msgs) : null) ?? (preview?.lastText || null),
      firstPrompt: (loaded ? firstPromptSnippet(msgs) : null) ?? (preview?.firstPrompt || null),
    });
  }

  const SUBTITLE_TONE_CLASS: Record<SessionSubtitle['tone'], string> = {
    working: 'text-primary/80',
    waiting: 'text-amber-500',
    context: 'text-muted-foreground/60',
  };

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
    icon: 'add' | 'rename' | 'folder' | 'stop' | 'destroy' | 'check';
    action: () => void;
    variant?: 'destructive';
    separator?: boolean;
  }

  function getContextMenuItems(sessionId: string): MenuItem[] {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    const items: MenuItem[] = [
      { label: 'New Conversation', icon: 'add', action: () => store.createAttachedSession(session.id, session.repoPath) },
      { label: 'Rename', icon: 'rename', action: () => startRename(sessionId, sessionLabel(session)) },
      { label: 'Open Folder', icon: 'folder', action: () => window.groveBench.openSessionFolder(sessionId) },
      // Completed sessions leave the working set (hidden unless "Show completed")
      // and come back on their own when the user sends another message.
      session.completedAt
        ? { label: 'Reopen', icon: 'check', action: () => store.setCompleted(sessionId, false) }
        : { label: 'Mark Completed', icon: 'check', action: () => store.setCompleted(sessionId, true) },
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
  let newAgentDefaultRepo = $state('');
  let confirmDestroyId = $state<string | null>(null);
  let destroying = $state<Set<string>>(new Set());
  let confirmRemoveRepo = $state<string | null>(null);
  let deleteBranchOnDestroy = $state(false);
  let renamingSessionId = $state<string | null>(null);
  let renameValue = $state('');
  let renameError = $state<string | null>(null);

  // ─── Bulk session clean-up ───
  let showCleanup = $state(false);
  let cleanupDays = $state('14');
  let cleanupSelection = $state<Record<string, boolean>>({});
  let cleanupDeleteBranches = $state(false);
  let confirmCleanup = $state(false);
  let cleaningUp = $state(false);
  const cleanupDayPresets = [7, 14, 30, 90];

  /** gh calls run at most this many at once while the dialog looks up PR
   *  state, so a long candidate list doesn't spawn a gh process per row in
   *  one burst (the status bar's poll is sequential for the same reason). */
  const CLEANUP_PR_CONCURRENCY = 3;

  /** sessionId → has uncommitted changes in its worktree. Absent = still checking / unknown. */
  let cleanupDirty = $state<Record<string, boolean>>({});
  /** sessionId → PR on the session's branch: the PR when one exists, null
   *  when there is none, 'unknown' when gh couldn't answer (offline, not
   *  logged in). Absent = still checking, or gh isn't available at all. */
  let cleanupPr = $state<Record<string, PrInfo | null | 'unknown'>>({});
  /** Candidates whose checks have started this dialog session (not reactive:
   *  read inside the effect without becoming a dependency). */
  const cleanupCheckedIds = new Set<string>();
  /** Bumped each time the dialog opens so results from a previous open are dropped. */
  let cleanupGeneration = 0;

  const cleanupDaysNum = $derived(Math.max(0, Math.floor(Number(cleanupDays)) || 0));
  const cleanupCandidates = $derived(store.stoppedSessionsOlderThan(cleanupDaysNum));
  /** Identity of the candidate set. The check effect keys off this rather
   *  than the array, so an unrelated store update (another session's status
   *  changing, a rename) doesn't reset the user's ticks or re-run the checks. */
  const cleanupCandidateKey = $derived(cleanupCandidates.map((s) => s.id).join('\n'));
  const cleanupSelectedIds = $derived(cleanupCandidates.map((s) => s.id).filter((id) => cleanupSelection[id]));
  const cleanupSelectedDirtyCount = $derived(cleanupSelectedIds.filter((id) => cleanupDirty[id]).length);
  const cleanupMergedCount = $derived(cleanupCandidates.filter((s) => isPrMerged(cleanupPrOf(s.id))).length);
  const cleanupGhAvailable = $derived(store.prerequisites?.gh?.available === true);

  function cleanupPrOf(id: string): PrInfo | null {
    const pr = cleanupPr[id];
    return pr && pr !== 'unknown' ? pr : null;
  }

  function openCleanup() {
    cleanupGeneration++;
    cleanupCheckedIds.clear();
    cleanupDirty = {};
    cleanupPr = {};
    cleanupSelection = {};
    showCleanup = true;
  }

  // When the dialog opens or the candidate set changes (cutoff edited, a
  // session removed): preselect the newly listed candidates, then check each
  // one's git status and PR state. Dirty ones are deselected: removing those
  // loses work, so they must be opted into explicitly. Candidates already
  // checked keep their results and whatever the user ticked.
  // Direct conversations skip the git status check: removing one deletes no
  // files and keeps the branch, so there is nothing to lose.
  $effect(() => {
    if (!showCleanup) return;
    void cleanupCandidateKey; // the only reactive dependency, on purpose
    const fresh = untrack(() => cleanupCandidates).filter((s) => !cleanupCheckedIds.has(s.id));
    if (fresh.length === 0) return;
    for (const s of fresh) cleanupCheckedIds.add(s.id);
    const generation = cleanupGeneration;
    const ghAvailable = untrack(() => cleanupGhAvailable);

    // Preselect the new rows; the async status check below deselects dirty ones.
    // (Reads are untracked so writing the same state here can't loop.)
    untrack(() => {
      const sel = { ...cleanupSelection };
      for (const s of fresh) sel[s.id] = true;
      cleanupSelection = sel;
    });

    (async () => {
      const dirty: Record<string, boolean> = {};
      await Promise.all(fresh.map(async (s) => {
        if (s.direct) {
          dirty[s.id] = false;
          return;
        }
        try {
          const status = await window.groveBench.getGitStatus(s.id);
          dirty[s.id] = status.entries.length > 0;
        } catch {
          dirty[s.id] = false; // unreadable worktree — nothing to lose
        }
      }));
      if (generation !== cleanupGeneration) return;
      cleanupDirty = { ...cleanupDirty, ...dirty };
      // Deselect dirty sessions without re-checking ones the user unticked
      const next = { ...cleanupSelection };
      for (const s of fresh) {
        if (dirty[s.id]) next[s.id] = false;
      }
      cleanupSelection = next;
    })();

    // PR state is looked up separately so a slow gh never delays the dirty
    // check, and skipped entirely when gh isn't installed (every call would fail).
    if (ghAvailable) {
      const queue = [...fresh];
      const worker = async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          let result: PrInfo | null | 'unknown';
          try {
            result = await window.groveBench.getPrInfo(s.id);
          } catch {
            result = 'unknown';
          }
          if (generation !== cleanupGeneration) return;
          cleanupPr = { ...cleanupPr, [s.id]: result };
        }
      };
      for (let i = 0; i < Math.min(CLEANUP_PR_CONCURRENCY, queue.length); i++) void worker();
    }
  });

  /** Tick every candidate without uncommitted changes (the initial state). */
  function cleanupSelectAllClean() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) sel[s.id] = !cleanupDirty[s.id];
    cleanupSelection = sel;
  }

  /** Tick only candidates whose PR has been merged. Their work has landed,
   *  so they are the safest to remove. Dirty ones stay unticked, same as the
   *  initial preselection. */
  function cleanupSelectMerged() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) sel[s.id] = isPrMerged(cleanupPrOf(s.id)) && !cleanupDirty[s.id];
    cleanupSelection = sel;
  }

  async function runCleanup() {
    const ids = cleanupSelectedIds;
    const deleteBranches = cleanupDeleteBranches;
    confirmCleanup = false;
    cleaningUp = true;
    for (const id of ids) {
      await destroySessionById(id, deleteBranches);
    }
    cleaningUp = false;
    showCleanup = false;
  }

  function relativeAge(ts: number): string {
    if (ts <= 0) return 'unknown age';
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days < 1) return 'today';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
  }

  function repoShortName(repoPath: string): string {
    return repoPath.split(/[/\\]/).pop() ?? repoPath;
  }

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
    // Refetch this session's preview next time it's needed — the cached one
    // (if any) predates the conversation that just ended.
    sessionPreviewStore.invalidate(id);
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

  /** Full teardown of one session: main-process destroy plus all per-session
   *  renderer state (messages + IPC listener, checkpoints, terminal). Shared
   *  by the per-row destroy flow and the bulk clean-up dialog. */
  async function destroySessionById(id: string, deleteBranch: boolean): Promise<boolean> {
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
      messageStore.destroySession(id);
      checkpointStore.clear(id);
      terminalStore.destroySession(id);
      bookmarkStore.dropSessionLocal(id);
      sessionPreviewStore.invalidate(id);
      return true;
    } catch (e: any) {
      store.setError(e.message || String(e));
      return false;
    } finally {
      const next = new Set(destroying);
      next.delete(id);
      destroying = next;
    }
  }

  async function confirmDestroy() {
    if (!confirmDestroyId) return;
    const id = confirmDestroyId;
    const deleteBranch = deleteBranchOnDestroy;
    confirmDestroyId = null;
    await destroySessionById(id, deleteBranch);
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
    return messageStore.needsInput(sessionId);
  }

  // ── Attention triage: filter chips, per-repo counts, completed sessions ──

  let triageFilter = $state<TriageFilter>('all');

  /** "Show completed" is a per-viewer convenience, so it lives in localStorage. */
  const SHOW_COMPLETED_KEY = 'grove-bench:sidebar-show-completed';
  let showCompleted = $state(false);
  try { showCompleted = localStorage.getItem(SHOW_COMPLETED_KEY) === '1'; } catch { /* storage unavailable */ }
  function toggleShowCompleted() {
    showCompleted = !showCompleted;
    try { localStorage.setItem(SHOW_COMPLETED_KEY, showCompleted ? '1' : '0'); } catch { /* ignore */ }
  }

  const TRIAGE_DOT: Record<Exclude<TriageFilter, 'all'>, string> = {
    'needs-you': 'bg-amber-500',
    working: 'bg-primary',
    unread: 'bg-green-400',
  };

  function triageOf(session: { id: string }): TriageState {
    return triageState({
      needsInput: messageStore.needsInput(session.id),
      running: messageStore.getIsRunning(session.id),
      unread: !!store.needsAttention[session.id],
    });
  }

  function notHiddenCompleted(session: { completedAt?: number | null }): boolean {
    return showCompleted || !session.completedAt;
  }

  /** Every session the sidebar considers (completed ones only when asked). */
  let visibleSessions = $derived(store.sessions.filter(notHiddenCompleted));

  /** Counts for the filter chips, over active and stopped sessions alike. */
  let counts = $derived(triageCounts(visibleSessions.map(triageOf)));

  function rowVisible(session: { id: string; completedAt?: number | null }): boolean {
    return notHiddenCompleted(session) && matchesTriageFilter(triageFilter, triageOf(session));
  }

  /** Live sessions (anything not stopped) that pass the filter, ordered by the
   *  active sort. This is the always-visible "working set". */
  let activeSessions = $derived(
    sortSessions(store.sessions.filter((s) => s.status !== 'stopped' && rowVisible(s)), sort),
  );

  let stoppedCount = $derived(visibleSessions.filter((s) => s.status === 'stopped').length);

  /** Attention counts for one repo's header (all of its sessions, any status). */
  function repoCounts(repo: string) {
    return triageCounts(store.sessionsForRepo(repo).filter(notHiddenCompleted).map(triageOf));
  }

  /** All sessions for a repo that pass the filter, grouped by branch (for the
   *  INACTIVE tree), with each group's sessions ordered by the active sort.
   *  Active (non-stopped) sessions are kept here too — the rows render
   *  greyed-out and non-clickable (they remain fully interactive in the ACTIVE
   *  list above). */
  function getInactiveBranchGroups(repo: string): [string, typeof store.sessions][] {
    const groups: Record<string, typeof store.sessions> = {};
    for (const s of store.sessionsForRepo(repo)) {
      if (!rowVisible(s)) continue;
      const key = s.branch || 'main';
      (groups[key] ??= []).push(s);
    }
    return Object.entries(groups).map(
      ([branch, sessions]): [string, typeof store.sessions] => [branch, sortSessions(sessions, sort)],
    );
  }
</script>

<aside
  class="relative border-r border-sidebar-border flex flex-col bg-sidebar shrink-0"
  style="width: {sidebarWidth}px"
>
  <!-- Reusable session row, shared by the Conversations list and the Projects tree -->
  {#snippet sessionRow(session: (typeof store.sessions)[number], showRepoPrefix: boolean, labelOverride: string | null, greyedOut: boolean = false)}
    {@const isDestroying = destroying.has(session.id)}
    {@const isStopped = session.status === 'stopped'}
    {@const repoColor = getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors)}
    {@const ts = session.lastActiveAt ?? session.createdAt}
    {@const subtitle = rowSubtitle(session)}
    {@const changedCount = isStopped ? 0 : gitStatusStore.getStatus(session.id).entries.length}
    <button
      onclick={() => { if (!isDestroying && !greyedOut) focusSession(session.id); }}
      oncontextmenu={(e) => { if (isDestroying || greyedOut) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
      disabled={isDestroying || greyedOut}
      title={greyedOut ? `${sessionRowLabel(session)} — live; manage it under Conversations above` : subtitle ? `${sessionRowLabel(session)}\n${subtitle.text}` : sessionRowLabel(session)}
      class="w-full flex flex-col pl-4 pr-2 py-1.5 text-left group/session transition-colors
        {greyedOut ? 'cursor-not-allowed' : isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
    >
      <div class="w-full flex items-center justify-between">
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
          <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground {greyedOut ? 'opacity-40' : ''}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" role="img" aria-label="Direct (no worktree)"><title>Direct (no worktree)</title><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z"/><path d="M12 8h6v2h-6z"/></svg>
        {:else}
          <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground {greyedOut ? 'opacity-40' : ''}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" role="img" aria-label="Worktree"><title>Worktree</title><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
        {/if}
        {#if session.completedAt}
          <svg class="w-3 h-3 shrink-0 text-green-500/70" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Completed"><title>Completed</title><path d="M20 6 9 17l-5-5"/></svg>
        {/if}
        <span class="text-sm truncate min-w-0 {greyedOut ? 'opacity-40' : ''} {session.completedAt ? 'text-muted-foreground' : ''}">
          {#if showRepoPrefix}{#if repoColor}<span class="inline-block w-1.5 h-1.5 align-middle mr-1" style="background-color: {repoColor}"></span>{/if}<span class="text-muted-foreground/70">{store.repoDisplayName(session.repoPath)}</span><span class="text-muted-foreground/40"> / </span>{/if}{labelOverride ?? sessionRowLabel(session)}
        </span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        {#if ts}
          <span class="text-[10px] text-muted-foreground/50 {greyedOut ? 'opacity-40' : 'group-hover/session:hidden'}" title="{session.lastActiveAt ? 'Last active' : 'Created'} {new Date(ts).toLocaleString()}">{formatAge(ts)}</span>
        {/if}
        {#if greyedOut}
          <!-- Active session shown here for context only; manage it under Conversations. -->
        {:else if isStopped}
          <!-- Stopped session: destroy (removes the worktree). -->
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
          <!-- Live session: stop (disconnect but keep it resumable). -->
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
      </div>
      {#if subtitle || changedCount > 0}
        <div class="w-full flex items-center gap-1.5 pl-4 pr-1 mt-0.5 min-w-0 {greyedOut ? 'opacity-40' : ''}">
          {#if subtitle}
            <span class="text-[11px] truncate min-w-0 {SUBTITLE_TONE_CLASS[subtitle.tone]}">{subtitle.text}</span>
          {/if}
          {#if changedCount > 0}
            <span
              class="ml-auto shrink-0 text-[10px] text-muted-foreground/60 border border-border/60 px-1 leading-4"
              title="{changedCount} changed file{changedCount === 1 ? '' : 's'} in the worktree"
            >±{changedCount}</span>
          {/if}
        </div>
      {/if}
    </button>
  {/snippet}

  <!-- Sort toggle, shared by the Conversations list and the Projects tree -->
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

  <!-- Search: opens the session finder (titles + full conversation content) -->
  <div class="px-3 pt-3">
    <button
      onclick={() => store.finderOpen = true}
      class="w-full flex items-center gap-2 px-2 py-1.5 bg-sidebar-accent/40 border border-sidebar-border text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent transition-colors"
      title="Search conversations (Ctrl+R)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <span class="text-xs truncate">Search conversations…</span>
      <span class="ml-auto text-[10px] text-muted-foreground/40 shrink-0">Ctrl+R</span>
    </button>
  </div>

  <div class="flex-1 overflow-auto px-3 py-3">
    <!-- Sort control (applies to active list + inactive sessions) -->
    <div class="flex items-center mb-2 px-1">
      <span class="text-[10px] text-muted-foreground/40 uppercase tracking-wide mr-auto">Sort</span>
      {@render sortButton('name', 'Name')}
      {@render sortButton('age', 'Age')}
    </div>

    <!-- Triage filter: what needs me, what is working, what finished while I was away -->
    <div class="flex items-center gap-1 mb-2 px-1 flex-wrap" role="group" aria-label="Filter conversations">
      {#each TRIAGE_FILTERS as f (f)}
        {@const n = counts[f]}
        {@const active = triageFilter === f}
        <button
          type="button"
          onclick={() => triageFilter = f}
          aria-pressed={active}
          class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] border transition-colors
            {active ? 'border-border bg-sidebar-accent text-foreground' : 'border-transparent text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent/50'}
            {n === 0 && f !== 'all' ? 'opacity-50' : ''}"
          title="{TRIAGE_FILTER_LABELS[f]}: {n}"
        >
          {#if f !== 'all'}<span class="w-1.5 h-1.5 shrink-0 {TRIAGE_DOT[f]}"></span>{/if}
          {TRIAGE_FILTER_LABELS[f]}
          <span class="text-muted-foreground/50">{n}</span>
        </button>
      {/each}
    </div>

    <!-- CONVERSATIONS: the live working set, always visible at the top -->
    <div class="flex items-center justify-between mb-1 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Conversations</span>
    </div>

    {#each activeSessions as session (session.id)}
      {@render sessionRow(session, true, null)}
    {/each}
    {#if activeSessions.length === 0}
      <p class="text-xs text-muted-foreground/50 pl-4 py-1">{triageFilter === 'all' ? 'No conversations' : `No conversations match "${TRIAGE_FILTER_LABELS[triageFilter]}"`}</p>
    {/if}

    <!-- PROJECTS: every repo with its sessions (stopped ones actionable); hosts repo management -->
    <div class="flex items-center justify-between mt-5 mb-2 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Projects</span>
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground/50">
        {#if stoppedCount}
          <span>{stoppedCount} stopped</span>
        {/if}
        {#if store.completedCount > 0}
          <button
            type="button"
            onclick={toggleShowCompleted}
            aria-pressed={showCompleted}
            class="flex items-center gap-1 hover:text-foreground transition-colors"
            title="{showCompleted ? 'Hide' : 'Show'} conversations you marked completed"
          >
            <span class="w-2.5 h-2.5 border border-current flex items-center justify-center">
              {#if showCompleted}<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>{/if}
            </span>
            Show completed ({store.completedCount})
          </button>
        {/if}
      </div>
    </div>

    {#each store.repos as repo (repo)}
      {@const canRemove = store.canRemoveRepo(repo)}
      {@const repoColor = getRepoColor(store.repos, repo, settingsStore.current.repoColors)}
      {@const inactiveGroups = getInactiveBranchGroups(repo)}
      {@const inactiveCount = inactiveGroups.reduce((n, [, s]) => n + s.length, 0)}
      {@const rc = repoCounts(repo)}
      {@const collapsed = isRepoCollapsed(collapsedRepos, repo)}
      <div class="mb-3">
        <!-- Repo header (click to collapse/expand the repo's inactive tree) -->
        <div class="flex items-center justify-between group px-1 py-1">
          <button
            type="button"
            onclick={() => toggleRepoCollapsed(repo)}
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-foreground transition-colors"
            title={collapsed ? 'Expand project' : 'Collapse project'}
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
            <!-- Per-repo attention counts, same dots as the filter chips -->
            {#if rc['needs-you']}
              <span class="flex items-center gap-0.5 text-[10px] text-amber-500 shrink-0" title="{rc['needs-you']} need{rc['needs-you'] === 1 ? 's' : ''} you"><span class="w-1.5 h-1.5 bg-amber-500"></span>{rc['needs-you']}</span>
            {/if}
            {#if rc.working}
              <span class="flex items-center gap-0.5 text-[10px] text-primary shrink-0" title="{rc.working} working"><span class="w-1.5 h-1.5 bg-primary"></span>{rc.working}</span>
            {/if}
            {#if rc.unread}
              <span class="flex items-center gap-0.5 text-[10px] text-green-400 shrink-0" title="{rc.unread} unread"><span class="w-1.5 h-1.5 bg-green-400"></span>{rc.unread}</span>
            {/if}
          </button>
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if store.canCreate}
              <button
                onclick={() => openNewAgent(repo)}
                class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-sidebar-accent transition-colors"
                title="New conversation in this project"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              </button>
            {/if}
            <button
              onclick={() => canRemove ? confirmRemoveRepo = repo : null}
              disabled={!canRemove}
              class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:text-muted-foreground/30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title={canRemove ? 'Remove project' : 'Destroy all conversations first'}
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
                  {@render sessionRow(session, false, session.displayName || `conversation ${i + 1}`, session.status !== 'stopped')}
                {/each}
              </div>
            {/if}
          {/each}

          {#if inactiveGroups.length === 0}
            <p class="text-xs text-muted-foreground/40 pl-4 py-1">{triageFilter === 'all' ? 'No conversations in this project' : `No conversations match "${TRIAGE_FILTER_LABELS[triageFilter]}"`}</p>
          {/if}
        {/if}
      </div>
    {/each}

    {#if store.repos.length === 0}
      <p class="text-xs text-muted-foreground/50 mt-2">Add a project to get started.</p>
    {/if}
  </div>

  <!-- Bottom controls -->
  <div class="px-3 py-3 border-t border-sidebar-border flex flex-col gap-2">
    <div class="flex gap-2">
      <div class="flex-1 min-w-0">
        <AddRepoButton {compact} />
      </div>
      <Button
        onclick={() => openNewAgent()}
        disabled={!store.canCreate}
        class="flex-1"
        size="sm"
        title="New conversation"
        aria-label="New conversation"
      >
        {#if compact}
          <MessageSquarePlusIcon aria-hidden="true" />
        {:else}
          + Conversation
        {/if}
      </Button>
    </div>
    <div class="flex justify-between px-1">
      <Button
        onclick={() => bookmarkStore.toggleDrawer()}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Bookmarks (Ctrl+B)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      </Button>
      <Button
        onclick={() => memoryStore.panelOpen = true}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Project Memory"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-1.5 0-3 .8-4 2s-1.5 3-2.5 3.5C4 8.5 3 10 3 12c0 1.5.5 3 1.5 4s1 2.5.5 3.5c.5 1.5 2 2.5 3.5 2.5H12"/><path d="M12 2c1.5 0 3 .8 4 2s1.5 2.5 2.5 3c1.5 1 2 2.5 2 4"/><path d="M12 2v20"/><path d="M12 8h5"/><path d="M12 14h4"/><circle cx="17.5" cy="8" r="1.2" fill="currentColor"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor"/></svg>
      </Button>
      <Button
        onclick={openCleanup}
        variant="ghost"
        size="sm"
        class="px-2 shrink-0"
        title="Clean up old conversations"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 11 9-9"/><path d="M14.6 12.6c.8.8.9 2.1.2 3L10 22l-8-8 6.4-4.8c.9-.7 2.2-.6 3 .2Z"/><path d="m6.8 10.4 6.8 6.8"/><path d="m5 17 1.4-1.4"/></svg>
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

  <!-- Resize handle: drag to adjust sidebar width (persisted) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={startResize}
    class="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10 -mr-0.5
      {resizing ? 'bg-primary/40' : 'hover:bg-primary/25'} transition-colors"
    title="Drag to resize sidebar"
  ></div>
</aside>

{#if showNewAgent}
  <NewAgentDialog onclose={() => showNewAgent = false} defaultRepo={newAgentDefaultRepo} />
{/if}

<SettingsPanel open={showSettings} onclose={() => showSettings = false} />
<MemoryPanel open={memoryStore.panelOpen} onclose={() => memoryStore.panelOpen = false} />

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

<!-- Clean up old sessions dialog -->
{#if showCleanup}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o && !cleaningUp) showCleanup = false; }}>
    <Dialog.Content class="max-w-md">
      <Dialog.Header>
        <Dialog.Title>Clean Up Old Conversations</Dialog.Title>
        <Dialog.Description>
          Remove stopped conversations you no longer need. Removing a conversation kills its shell and deletes its worktree. Conversations with uncommitted changes are flagged and left unselected — tick them only if you're sure. Each conversation's pull request state is shown when the GitHub CLI is available; merged ones are the safest to remove. Branches are kept unless you choose otherwise. Running conversations are never listed.
        </Dialog.Description>
      </Dialog.Header>

      <div class="flex items-center gap-2">
        <Label class="shrink-0">Inactive for</Label>
        <input
          type="number"
          min="0"
          bind:value={cleanupDays}
          class="w-16 text-sm bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
        />
        <span class="text-xs text-muted-foreground">days</span>
        <div class="flex gap-1 ml-1">
          {#each cleanupDayPresets as d}
            <button
              onclick={() => cleanupDays = String(d)}
              class="text-xs px-1.5 py-0.5 border transition-colors
                {cleanupDaysNum === d ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
            >
              {d}
            </button>
          {/each}
        </div>
      </div>

      {#if cleanupCandidates.length === 0}
        <p class="text-sm text-muted-foreground/50 py-2">No stopped conversations inactive for {cleanupDaysNum} days.</p>
      {:else}
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>{cleanupSelectedIds.length} of {cleanupCandidates.length} selected</span>
          <span class="flex items-center gap-2">
            <button
              type="button"
              onclick={cleanupSelectAllClean}
              class="hover:text-foreground hover:underline"
              title="Tick every listed conversation without uncommitted changes"
            >
              Select all
            </button>
            {#if cleanupGhAvailable}
              <button
                type="button"
                onclick={cleanupSelectMerged}
                disabled={cleanupMergedCount === 0}
                class="text-purple-400 hover:text-purple-300 hover:underline disabled:opacity-50 disabled:no-underline"
                title="Tick only conversations whose pull request has been merged (and that have no uncommitted changes)"
              >
                Select merged ({cleanupMergedCount})
              </button>
            {/if}
          </span>
        </div>
        <div class="flex flex-col gap-1 max-h-64 overflow-auto">
          {#each cleanupCandidates as session (session.id)}
            {@const pr = cleanupPrOf(session.id)}
            {@const prFlag = pr ? prStateFlag(pr) : null}
            <label class="flex items-center gap-2 px-2 py-1.5 bg-card border border-border cursor-pointer">
              <input
                type="checkbox"
                checked={cleanupSelection[session.id] ?? false}
                onchange={(e) => cleanupSelection[session.id] = e.currentTarget.checked}
              />
              <div class="min-w-0 flex-1">
                <div class="text-sm text-foreground truncate" title={session.branch}>
                  {sessionRowLabel(session)}
                </div>
                <div class="text-xs text-muted-foreground">
                  {repoShortName(session.repoPath)} · {relativeAge(session.ts)}
                  {#if pr && prFlag}
                    <span class="{prFlag.colorClass} font-medium" title={pr.title ? `${pr.title} (${pr.url})` : pr.url} data-testid="cleanup-pr-{session.id}">· PR #{pr.number} {prFlag.label}</span>
                  {:else if cleanupPr[session.id] === null}
                    <span class="text-muted-foreground/60" data-testid="cleanup-pr-{session.id}">· no PR</span>
                  {:else if cleanupPr[session.id] === 'unknown'}
                    <span class="text-muted-foreground/60" title="The GitHub CLI could not look up this branch's pull request (offline or not logged in)" data-testid="cleanup-pr-{session.id}">· PR unknown</span>
                  {/if}
                  {#if cleanupDirty[session.id]}
                    <span class="text-amber-500 font-medium">· uncommitted changes</span>
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>
        <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <Checkbox bind:checked={cleanupDeleteBranches} />
          Also delete their branches
        </label>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => showCleanup = false} disabled={cleaningUp}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={cleanupSelectedIds.length === 0 || cleaningUp}
          onclick={() => confirmCleanup = true}
        >
          {cleaningUp
            ? 'Removing…'
            : `Remove ${cleanupSelectedIds.length} ${cleanupSelectedIds.length === 1 ? 'conversation' : 'conversations'}`}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Clean-up confirmation -->
{#if confirmCleanup}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmCleanup = false; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Remove Conversations?</Dialog.Title>
        <Dialog.Description>
          Permanently remove {cleanupSelectedIds.length} {cleanupSelectedIds.length === 1 ? 'conversation' : 'conversations'} and {cleanupSelectedIds.length === 1 ? 'its worktree' : 'their worktrees'}{cleanupDeleteBranches ? ', and delete their branches' : ' (branches are kept)'}?
          {#if cleanupSelectedDirtyCount > 0}
            <span class="text-amber-500 font-medium">
              {cleanupSelectedDirtyCount} of them {cleanupSelectedDirtyCount === 1 ? 'has' : 'have'} uncommitted changes that will be lost.
            </span>
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmCleanup = false}>Cancel</Button>
        <Button variant="destructive" onclick={runCleanup}>Remove</Button>
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
            This will stop the conversation on branch
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
        <Dialog.Title>Remove Project?</Dialog.Title>
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
