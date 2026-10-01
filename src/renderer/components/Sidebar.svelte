<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { trackEvent } from '../lib/analytics.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import AddRepoButton from './AddRepoButton.svelte';
  import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
  import { draftStore } from '../stores/draft.svelte.js';
  import { groupStore } from '../stores/groups.svelte.js';
  import SidebarGroups from './SidebarGroups.svelte';
  import AttentionCounts from './AttentionCounts.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { unsavedFileCount } from '../lib/unsaved-files.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import { memoryStore } from '../stores/memory.svelte.js';
  import ContextMenu from './ContextMenu.svelte';
  import { formatAge } from '../lib/format-age.js';
  import { isRepoCollapsed } from '../lib/repo-collapse.js';
  import { sortSessions, defaultDirFor } from '../lib/session-sort.js';
  import { triageForSprite, triageCounts, matchesTriageFilter, TRIAGE_FILTERS, TRIAGE_FILTER_LABELS, type TriageFilter, type TriageState } from '../lib/session-triage.js';
  import { sessionSubtitle, pendingPermissionTool, pendingPermissionView, lastTextSnippet, firstPromptSnippet, type SessionSubtitle } from '../lib/session-subtitle.js';
  import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
  import { prStateFlag, isPrMerged, prHealth } from '../lib/pr-state.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { forgetConversation } from '$lib/forget-conversation.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import AgentSprite from './AgentSprite.svelte';
  import StatusDot from './StatusDot.svelte';
  import { mapLimit } from '../lib/map-limit.js';
  import PanelToggle from './PanelToggle.svelte';
  import { panelStore } from '../stores/panels.svelte.js';
  import type { SessionSortState, PrInfo } from '../../shared/types.js';
  import { limitedQueue } from '../lib/limited-queue.js';
  import { onMount, untrack } from 'svelte';

  // Per-repo accordion collapse state, persisted via app-state. An explicit
  // entry wins; otherwise repos default to collapsed (see isRepoCollapsed).
  // Loaded on mount; the empty map renders the correct default immediately, so
  // there's no flash of expanded content.
  let collapsedRepos = $state<Record<string, boolean>>({});

  // User-resizable sidebar width (px), persisted via app-state.
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 300;
  // Below this width the "+ Project" / "+ Conversation" labels no longer
  // fit side by side, so the bottom buttons collapse to icons.
  const SIDEBAR_COMPACT_BELOW = 280;
  let sidebarWidth = $state(SIDEBAR_DEFAULT);
  let compact = $derived(sidebarWidth < SIDEBAR_COMPACT_BELOW);
  let resizing = $state(false);
  // Folded down to a rail: the open conversations' status marks and the
  // footer's buttons. The full sidebar stays mounted (hidden) so its scroll
  // position and filters are still there when it opens again.
  const RAIL_WIDTH = 48;
  let collapsed = $derived(panelStore.isCollapsed('sidebar'));

  onMount(async () => {
    let savedWidth: number | null;
    // Session ordering (name/age, asc/desc) lives in the store so the landing
    // shares it; persisted via app-state.
    [collapsedRepos, store.sessionSort, savedWidth] = await Promise.all([
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
    const isRunning = messageStore.getIsRunning(session.id);
    const pendingTool = loaded ? pendingPermissionTool(msgs) : null;
    // Past messages only show when nothing live does, so skip that work while
    // the agent runs (its reply grows with every update) or waits on you.
    const quiet = !isRunning && !pendingTool;
    const lastText = quiet ? ((loaded ? lastTextSnippet(msgs) : null) ?? (preview?.lastText || null)) : null;
    const firstPrompt = quiet && !lastText ? ((loaded ? firstPromptSnippet(msgs) : null) ?? (preview?.firstPrompt || null)) : null;
    const pendingToolView = pendingTool ? pendingPermissionView(msgs) : undefined;
    return sessionSubtitle({ isRunning, activity: messageStore.getActivity(session.id), pendingTool, pendingToolView, lastText, firstPrompt });
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
    const sort = store.sessionSort;
    store.sessionSort = key === sort.key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: defaultDirFor(key) };
    window.groveBench.setSessionSort($state.snapshot(store.sessionSort));
  }

  let contextMenu = $state<{ x: number; y: number; sessionId: string } | null>(null);

  function openContextMenu(e: MouseEvent, sessionId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, sessionId };
  }

  interface MenuItem {
    label: string;
    icon: 'rename' | 'folder' | 'destroy' | 'check' | 'add' | 'close';
    action: () => void;
    variant?: 'destructive';
    separator?: boolean;
  }

  function getContextMenuItems(sessionId: string): MenuItem[] {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    const items: MenuItem[] = [
      { label: 'Rename', icon: 'rename', action: () => startRename(sessionId, sessionLabel(session)) },
      { label: 'Open Folder', icon: 'folder', action: () => window.groveBench.openSessionFolder(sessionId) },
    ];
    // Close Conversation stops a live session (it was called Stop, then Mark
    // Completed) but keeps it resumable from Ctrl+R; not shown for
    // already-stopped ones. For an open tab still waiting to reconnect it
    // just closes the tab.
    if (store.isOpenTab(session)) {
      items.push({ label: 'Close Conversation', icon: 'close', action: () => stopSession(sessionId) });
    }
    items.push(...groupMenuItems(sessionId));
    items.push({ label: 'Delete Conversation', icon: 'destroy', action: () => requestDestroy(sessionId), variant: 'destructive', separator: true });
    return items;
  }

  /** Group actions for a conversation: leave its group, join another, or
   *  start a new one with it. */
  function groupMenuItems(sessionId: string): MenuItem[] {
    // Until the saved groups are read, changing them could write over them.
    if (!groupStore.ready) return [];
    const current = groupStore.groupOf(sessionId);
    const items: MenuItem[] = [];
    if (current) {
      items.push({ label: `Remove from ${current.name}`, icon: 'close', action: () => groupStore.remove(sessionId) });
    }
    for (const g of groupStore.groups) {
      if (g.id === current?.id) continue;
      items.push({ label: `${current ? 'Move' : 'Add'} to ${g.name}`, icon: 'add', action: () => groupStore.add(g.id, sessionId) });
    }
    items.push({ label: 'New Group…', icon: 'add', action: () => { groupStore.nameRequest = { kind: 'new', sessionId }; } });
    items[0].separator = true;
    return items;
  }

  // Settings and Memory load when first opened, then stay mounted.
  const loadSettingsPanel = lazyComponent(() => import('./SettingsPanel.svelte'));
  const loadMemoryPanel = lazyComponent(() => import('./MemoryPanel.svelte'));
  let settingsOpened = $state(false);
  let memoryOpened = $state(false);
  $effect(() => { if (settingsStore.panelOpen) settingsOpened = true; });
  $effect(() => { if (memoryStore.panelOpen) memoryOpened = true; });
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

  /** Checks run at most this many at once per kind (git status, gh), so a
   *  long candidate list doesn't spawn a process per row in one burst (the
   *  status bar's PR poll is sequential for the same reason). Each git status
   *  check itself runs a few git commands. */
  const CLEANUP_CONCURRENCY = 3;

  /** sessionId → has uncommitted changes in its worktree (or its status
   *  couldn't be read, so it may have). Absent = still checking. */
  let cleanupDirty = $state<Record<string, boolean>>({});
  /** sessionId → true when git couldn't read its status. */
  let cleanupStatusUnknown = $state<Record<string, boolean>>({});
  /** sessionId → the session's primary PR (list head: open before merged or
   *  closed, newest first), null when it has none, 'unknown' when gh couldn't
   *  answer (offline, not logged in). Absent = still checking, or gh isn't
   *  available at all. */
  let cleanupPr = $state<Record<string, PrInfo | null | 'unknown'>>({});
  /** Candidates whose checks have started this dialog session (not reactive:
   *  read inside the effect without becoming a dependency). */
  const cleanupCheckedIds = new Set<string>();
  /** Bumped each time the dialog opens so results from a previous open are dropped. */
  let cleanupGeneration = 0;
  /** Shared by every run of the check effect, so editing the cutoff queues
   *  more rows instead of starting more processes. Separate queues, so a
   *  slow gh never holds up the uncommitted-changes checks. */
  const cleanupStatusQueue = limitedQueue(CLEANUP_CONCURRENCY);
  const cleanupPrQueue = limitedQueue(CLEANUP_CONCURRENCY);
  // Closing the dialog drops the checks not started; opening it starts over.
  $effect(() => {
    if (showCleanup) return;
    cleanupStatusQueue.clear();
    cleanupPrQueue.clear();
  });

  /** Days from the field, or null while it's empty or not a number (a
   *  number input binds null when cleared, which would otherwise read as 0
   *  days and list every stopped conversation). */
  const cleanupDaysNum = $derived.by(() => {
    const raw = cleanupDays as unknown;
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) ? Math.max(0, n) : null;
  });
  const cleanupCandidates = $derived(cleanupDaysNum === null ? [] : store.stoppedSessionsOlderThan(cleanupDaysNum));
  /** Identity of the candidate set. The check effect keys off this rather
   *  than the array, so an unrelated store update (another session's status
   *  changing, a rename) doesn't reset the user's ticks or re-run the checks. */
  const cleanupCandidateKey = $derived(cleanupCandidates.map((s) => s.id).join('\n'));
  const cleanupSelectedIds = $derived(cleanupCandidates.map((s) => s.id).filter((id) => cleanupSelection[id]));
  const cleanupSelectedDirtyCount = $derived(cleanupSelectedIds.filter((id) => cleanupDirty[id]).length);
  /** Listed candidates known to have uncommitted changes: "Select all" leaves these out. */
  const cleanupDirtyCount = $derived(cleanupCandidates.filter((s) => cleanupDirty[s.id]).length);
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
    cleanupStatusUnknown = {};
    cleanupPr = {};
    cleanupSelection = {};
    cleanupStatusQueue.clear();
    cleanupPrQueue.clear();
    showCleanup = true;
  }

  // When the dialog opens or the candidate set changes (cutoff edited, a
  // session removed): check each newly listed candidate's git status and PR
  // state, and tick it once it is known to be clean. Dirty ones, and ones
  // whose status couldn't be read, stay unticked: removing those can lose
  // work (removal falls back to --force), so they must be opted into
  // explicitly. Candidates already checked keep their results and whatever
  // the user ticked.
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

    // Each row is settled as its own check comes back, so one slow worktree
    // doesn't hold up the rest.
    function settle(id: string, dirty: boolean, unknown: boolean) {
      if (generation !== cleanupGeneration) return;
      cleanupDirty = { ...cleanupDirty, [id]: dirty };
      if (unknown) cleanupStatusUnknown = { ...cleanupStatusUnknown, [id]: true };
      // Tick it when clean, unless the user already decided about it.
      if (cleanupSelection[id] === undefined) cleanupSelection = { ...cleanupSelection, [id]: !dirty };
    }
    untrack(() => {
      for (const s of fresh) {
        if (s.direct) { settle(s.id, false, false); continue; }
        cleanupStatusQueue.add(async () => {
          let dirty: boolean;
          let unknown: boolean;
          try {
            const status = await window.groveBench.getGitStatus(s.id);
            // A status git couldn't read may hide changes: treat it as dirty.
            unknown = !!status.error;
            dirty = unsavedFileCount(status.entries, agentsStore.generatedFiles()) > 0 || unknown;
          } catch {
            dirty = unknown = true;
          }
          settle(s.id, dirty, unknown);
        });
      }

      // PR state is skipped entirely when gh isn't installed (every call would fail).
      if (!ghAvailable) return;
      for (const s of fresh) {
        cleanupPrQueue.add(async () => {
          let result: PrInfo | null | 'unknown';
          try {
            result = (await window.groveBench.getPrs(s.id))[0] ?? null;
          } catch {
            result = 'unknown';
          }
          if (generation === cleanupGeneration) cleanupPr = { ...cleanupPr, [s.id]: result };
        });
      }
    });
  });

  /** Tick every candidate known to have no uncommitted changes (the initial
   *  state). Ones still being checked are left undecided, so they are
   *  ticked if their check comes back clean. */
  function cleanupSelectAllClean() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) {
      if (cleanupDirty[s.id] !== undefined) sel[s.id] = !cleanupDirty[s.id];
    }
    cleanupSelection = sel;
  }

  /** Tick only candidates whose PR has been merged. Their work has landed,
   *  so they are the safest to remove. Dirty ones stay unticked, same as the
   *  initial preselection. */
  function cleanupSelectMerged() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) {
      const merged = isPrMerged(cleanupPrOf(s.id));
      // A merged one still being checked is ticked once it comes back clean.
      if (merged && cleanupDirty[s.id] === undefined) continue;
      sel[s.id] = merged && cleanupDirty[s.id] === false;
    }
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

  /** Close Conversation: stop a session non-destructively. Shuts down its agent,
   *  background tasks and terminal (freeing any ports they held) but keeps the
   *  worktree so it can be resumed by clicking it (auto-resume in App.svelte).
   *  Closing it means it was dealt with, so it no longer counts as unread. */
  async function stopSession(id: string) {
    store.pushRecentlyClosed(id);
    store.clearNeedsAttention(id);
    // Back to the landing screen rather than jumping into another conversation.
    if (store.activeSessionId === id) store.activeSessionId = null;
    store.updateStatus(id, 'stopped');
    store.clearDeferredResume(id);
    terminalStore.markClosed(id);
    // Refetch this session's preview next time it's needed — the cached one
    // (if any) predates the conversation that just ended.
    sessionPreviewStore.invalidate(id);
    try {
      await window.groveBench.closeSession(id);
    } catch { /* session may already be dead */ }
  }

  /** Open a draft conversation in `repo` (default: the open conversation's
   *  project). Nothing is created until its first message is sent. */
  function openNewAgent(repo = '') {
    draftStore.open(repo);
  }

  /** What deleting the conversation in the confirm dialog would lose: files
   *  with uncommitted changes in its worktree, and commits on its branch
   *  that its base branch doesn't have. Null while unknown. */
  let destroyUncommitted = $state<number | null>(null);
  let destroyUnmerged = $state<{ count: number; base: string } | null>(null);
  /** Delete waits for both checks, so a quick click can't skip a warning. */
  let destroyChecking = $state(false);

  function requestDestroy(id: string) {
    confirmDestroyId = id;
    deleteBranchOnDestroy = false;
    destroyUncommitted = null;
    destroyUnmerged = null;
    destroyChecking = false;
    const session = store.sessions.find((s) => s.id === id);
    if (!session || session.direct) return;
    destroyChecking = true;
    // Best effort: a failed check leaves its warning out rather than
    // blocking the delete.
    const uncommitted = window.groveBench.getGitStatus(id)
      .then((status) => { if (confirmDestroyId === id) destroyUncommitted = unsavedFileCount(status.entries, agentsStore.generatedFiles()); })
      .catch(() => {});
    const unmerged = resolveBaseBranch(session.repoPath)
      .then(async (base) => {
        const commits = await window.groveBench.getBranchCommits(id, base);
        if (confirmDestroyId === id) destroyUnmerged = { count: commits.length, base };
      })
      .catch(() => {});
    void Promise.all([uncommitted, unmerged]).then(() => { if (confirmDestroyId === id) destroyChecking = false; });
  }

  /** Full teardown of one session: main-process destroy plus all per-session
   *  renderer state (see forgetConversation). Shared
   *  by the per-row destroy flow and the bulk clean-up dialog. */
  async function destroySessionById(id: string, deleteBranch: boolean): Promise<boolean> {
    destroying = new Set([...destroying, id]);

    // Mark stopped immediately so the tab closes right away
    store.updateStatus(id, 'stopped');

    // Deactivate so the auto-resume $effect doesn't bring the tab back, and
    // land on the landing screen rather than another conversation.
    if (store.activeSessionId === id) store.activeSessionId = null;

    try {
      await window.groveBench.destroySession(id, deleteBranch);
      trackEvent('session_destroyed');
      forgetConversation(id);
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

  /** The conversations the remove-project dialog checked and will delete.
   *  Fixed when it opens, so nothing is deleted without its checks. */
  let removeRepoIds = $state<string[]>([]);
  /** What removing the project in the confirm dialog would lose, over all of
   *  its conversations: how many have uncommitted changes, and how many of
   *  their branches have commits the base branch doesn't. Null while unknown. */
  let removeRepoDirty = $state<number | null>(null);
  let removeRepoUnmerged = $state<{ count: number; base: string } | null>(null);
  /** Remove waits for both checks, as Delete does for one conversation. */
  let removeRepoChecking = $state(false);
  let removeRepoDeleteBranches = $state(false);
  let removingRepo = $state(false);
  /** Set when conversations appeared while the dialog was open, so it checked again. */
  let removeRepoRechecked = $state(false);
  /** Bumped per request so a slow check from an earlier open is dropped. */
  let removeRepoGeneration = 0;
  /** git calls the checks run at once, so a big project doesn't start one
   *  process per conversation in a burst (as the clean-up limits gh). */
  const REMOVE_CHECK_CONCURRENCY = 3;

  function requestRemoveRepo(repo: string) {
    const generation = ++removeRepoGeneration;
    const sessions = store.sessionsForRepo(repo);
    confirmRemoveRepo = repo;
    removeRepoIds = sessions.map((s) => s.id);
    removeRepoDeleteBranches = false;
    removeRepoRechecked = false;
    removeRepoDirty = null;
    removeRepoUnmerged = null;
    removingRepo = false;
    // Direct conversations work in the project folder itself: removing one
    // deletes no files and keeps the branch, so there is nothing to check.
    const worktreeSessions = sessions.filter((s) => !s.direct);
    removeRepoChecking = worktreeSessions.length > 0;
    if (!removeRepoChecking) return;
    const current = () => generation === removeRepoGeneration && confirmRemoveRepo === repo;
    // Best effort, like the single delete: a failed check leaves its warning
    // out. Uncommitted changes first, then unmerged commits (one per branch:
    // conversations sharing a branch share its commits).
    void (async () => {
      const dirty = await mapLimit(worktreeSessions, REMOVE_CHECK_CONCURRENCY, (s) =>
        window.groveBench.getGitStatus(s.id)
          .then((status) => unsavedFileCount(status.entries, agentsStore.generatedFiles()) > 0)
          .catch(() => false),
      );
      if (!current()) return;
      removeRepoDirty = dirty.filter(Boolean).length;
      const base = await resolveBaseBranch(repo);
      const oneSessionPerBranch = [...new Map(worktreeSessions.map((s) => [s.branch, s])).values()];
      const commits = await mapLimit(oneSessionPerBranch, REMOVE_CHECK_CONCURRENCY, (s) =>
        window.groveBench.getBranchCommits(s.id, base).then((c) => c.length).catch(() => 0),
      );
      if (!current()) return;
      removeRepoUnmerged = { count: commits.filter((n) => n > 0).length, base };
      removeRepoChecking = false;
    })();
  }

  /** Delete the project's checked conversations, then remove the project. */
  async function confirmRemoveProject() {
    const repo = confirmRemoveRepo;
    if (!repo) return;
    // A conversation started or restored since the dialog opened hasn't been
    // checked: check again, keeping the branch choice, rather than delete it blind.
    if (store.sessionsForRepo(repo).some((s) => !removeRepoIds.includes(s.id))) {
      const deleteBranches = removeRepoDeleteBranches;
      requestRemoveRepo(repo);
      removeRepoDeleteBranches = deleteBranches;
      removeRepoRechecked = true;
      return;
    }
    const deleteBranches = removeRepoDeleteBranches;
    removingRepo = true;
    // One at a time, as the clean-up does. Stop at the first failure (its
    // error is shown) so the project stays listed with what is left.
    for (const id of removeRepoIds) {
      if (!store.sessions.some((s) => s.id === id)) continue; // already gone
      if (!(await destroySessionById(id, deleteBranches))) {
        removingRepo = false;
        confirmRemoveRepo = null;
        return;
      }
    }
    await handleRemoveRepo(repo);
    removingRepo = false;
  }

  async function handleRemoveRepo(repoPath: string) {
    try {
      await window.groveBench.removeRepo(repoPath);
      store.removeRepo(repoPath);
      // A draft can't start in a project that's gone.
      if (draftStore.draft?.repoPath === repoPath) draftStore.discard();
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
   *  prefix when shared. A conversation in a folder without git has no branch
   *  and is named after its first turn, so until then it's "New conversation".
   *  Kept separate from sessionLabel so rename prefill and no-op detection use
   *  the plain name without the index. */
  function sessionRowLabel(s: { id: string; repoPath: string; displayName?: string | null; branch: string }): string {
    if (s.displayName) return s.displayName;
    return s.branch ? branchIndex(s) + s.branch : 'New conversation';
  }

  function startRename(sessionId: string, currentLabel: string) {
    renamingSessionId = sessionId;
    renameValue = currentLabel;
    renameError = null;
  }

  async function confirmRename() {
    // Held across the save: the dialog can close (or open on another
    // conversation) before it returns, and the name is saved either way.
    const id = renamingSessionId;
    if (!id) return;
    const newName = renameValue.trim();
    if (!newName) { renamingSessionId = null; return; }

    const session = store.sessions.find(s => s.id === id);
    if (session && newName === sessionLabel(session)) { renamingSessionId = null; return; }

    try {
      await window.groveBench.renameSession(id, newName);
      store.updateDisplayName(id, newName);
      if (renamingSessionId === id) {
        renamingSessionId = null;
        renameError = null;
      }
    } catch (e: any) {
      if (renamingSessionId === id) renameError = e.message || String(e);
    }
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
  }

  // ── Attention triage: filter chips, per-repo counts ──

  let triageFilter = $state<TriageFilter>('all');

  /** The chips shown. There is no "All" chip: clicking the active chip
   *  again goes back to all, which keeps the row to one line. */
  const CHIP_FILTERS = TRIAGE_FILTERS.filter((f): f is Exclude<TriageFilter, 'all'> => f !== 'all');

  function toggleFilter(f: TriageFilter) {
    triageFilter = triageFilter === f ? 'all' : f;
  }

  const TRIAGE_DOT: Record<Exclude<TriageFilter, 'all'>, string> = {
    'needs-you': 'bg-amber-500',
    working: 'bg-primary',
    unread: 'bg-green-400',
  };

  /** Branch groups folded in the Projects tree, by project and branch. Kept
   *  for this run only: groups come and go with their conversations. */
  let collapsedBranches = $state<Record<string, boolean>>({});
  const branchKey = (repo: string, branch: string) => `${repo}\n${branch}`;

  function toggleBranchCollapsed(repo: string, branch: string) {
    const key = branchKey(repo, branch);
    collapsedBranches = { ...collapsedBranches, [key]: !collapsedBranches[key] };
  }

  /** Which chip a conversation counts under: the one its status colour matches. */
  function triageOf(session: { id: string; status: string }): TriageState {
    return triageForSprite(sessionSpriteState(session, destroying.has(session.id)));
  }

  /** Counts for the filter chips, over active and stopped sessions alike. */
  let counts = $derived(triageCounts(store.sessions.map(triageOf)));

  function rowVisible(session: { id: string; status: string }): boolean {
    return matchesTriageFilter(triageFilter, triageOf(session));
  }

  /** Open tabs (live sessions, plus restored tabs waiting to reconnect) that pass the filter, ordered by the
   *  active sort. This is the always-visible "working set"; the landing's picker shows the same list. */
  let activeSessions = $derived(
    store.openConversations.filter(rowVisible),
  );

  /** Closed conversations: stopped and not an open tab. */
  let closedCount = $derived(store.sessions.filter((s) => !store.isOpenTab(s)).length);

  /** Attention counts for a header (a project's or a group's conversations,
   *  any status). */
  function headerCounts(sessions: typeof store.sessions) {
    return triageCounts(sessions.map(triageOf));
  }

  function repoCounts(repo: string) {
    return headerCounts(store.sessionsForRepo(repo));
  }

  /** All sessions for a repo that pass the filter, grouped by branch (for the
   *  Projects tree), with each group's sessions ordered by the active sort.
   *  Open conversations are listed here too, and work the same as in the
   *  Conversations list above. */
  function getBranchGroups(repo: string): [string, typeof store.sessions][] {
    const groups: Record<string, typeof store.sessions> = {};
    for (const s of store.sessionsForRepo(repo)) {
      if (!rowVisible(s)) continue;
      const key = s.branch || 'main';
      (groups[key] ??= []).push(s);
    }
    return Object.entries(groups).map(
      ([branch, sessions]): [string, typeof store.sessions] => [branch, sortSessions(sessions, store.sessionSort)],
    );
  }
</script>

<aside
  class="relative border-r border-sidebar-border flex flex-col bg-sidebar shrink-0"
  style="width: {collapsed ? RAIL_WIDTH : sidebarWidth}px"
>
  <!-- Bookmarks, memory, clean-up and settings: in the footer, or down the rail -->
  {#snippet footerTools()}
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
      onclick={() => settingsStore.panelOpen = true}
      variant="ghost"
      size="sm"
      class="px-2 shrink-0"
      title="Settings (Ctrl+,)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
    </Button>
  {/snippet}

  <!-- A conversation's status: its grove character, or a dot in the same colour -->
  {#snippet statusMark(session: (typeof store.sessions)[number], isDestroying: boolean, repoColor: string | null)}
    {#if settingsStore.current.groveCharacters}
      <AgentSprite state={sessionSpriteState(session, isDestroying)} seed={session.id} projectColor={repoColor} />
    {:else}
      <StatusDot state={sessionSpriteState(session, isDestroying)} />
    {/if}
  {/snippet}

  <!-- Reusable session row, shared by the Conversations list, the Groups section and the Projects tree -->
  {#snippet sessionRow(session: (typeof store.sessions)[number], showProject: boolean, labelOverride: string | null, showGroup: boolean)}
    {@const isDestroying = destroying.has(session.id)}
    {@const isStopped = session.status === 'stopped'}
    <!-- Faded a little while its agent is off, matching its character: asleep
         (back when opened), and a step further once closed. -->
    {@const spriteState = sessionSpriteState(session, isDestroying)}
    {@const restFade = spriteState === 'stopped' ? 'opacity-60' : spriteState === 'sleeping' ? 'opacity-70' : ''}
    {@const repoColor = getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors)}
    {@const ts = session.lastActiveAt ?? session.createdAt}
    {@const subtitle = rowSubtitle(session)}
    {@const changedCount = isStopped ? 0 : gitStatusStore.getStatus(session.id).entries.length}
    {@const label = labelOverride ?? sessionRowLabel(session)}
    {@const group = showGroup ? groupStore.groupOf(session.id) : null}
    <!-- PR data is only polled for open tabs; anything else would be stale, so it stays neutral. -->
    {@const pr = store.isOpenTab(session) ? prStore.getPr(session.id) : null}
    {@const health = prHealth(pr)}
    {@const branchIconLabel = (session.noGit ? 'In the project folder (no git)' : session.direct ? 'Direct (no worktree)' : 'Worktree') + (pr ? `, PR #${pr.number}: ${health.label}` : '')}
    <!-- The quick action is a sibling of the row button, not inside it: a button can't hold another. -->
    <div
      class="relative group/session"
      oncontextmenu={(e) => { if (isDestroying) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
      role="presentation"
    >
      <button
        onclick={() => { if (!isDestroying) focusSession(session.id); }}
        disabled={isDestroying}
        title={subtitle ? `${label}\n${subtitle.text}` : label}
        class="w-full flex flex-col pl-4 pr-2 py-1.5 text-left transition-colors
          {isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}
          {restFade}"
      >
        <!-- Line 1 is the conversation's name, so it gets the width; the project goes on line 2. -->
        <div class="w-full flex items-center gap-2 min-w-0">
          {@render statusMark(session, isDestroying, repoColor)}
          {#if session.direct}
            <svg class="w-3.5 h-3.5 shrink-0 {health.textClass}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" role="img" aria-label={branchIconLabel} title={branchIconLabel} data-pr-health={health.kind}><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z"/><path d="M12 8h6v2h-6z"/></svg>
          {:else}
            <svg class="w-3.5 h-3.5 shrink-0 {health.textClass}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" role="img" aria-label={branchIconLabel} title={branchIconLabel} data-pr-health={health.kind}><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
          {/if}
          <span class="text-sm truncate min-w-0 flex-1">{label}</span>
          {#if ts}
            <!-- Invisible, not hidden, while the quick action sits over it, so the name doesn't reflow. -->
            <span
              class="shrink-0 text-[10px] text-muted-foreground/50 {isDestroying ? '' : 'group-hover/session:invisible group-has-[:focus-visible]/session:invisible'}"
              title="{session.lastActiveAt ? 'Last active' : 'Created'} {new Date(ts).toLocaleString()}"
            >{formatAge(ts)}</span>
          {/if}
        </div>
        {#if group || showProject || subtitle || changedCount > 0}
          <div class="w-full flex items-center gap-1.5 pl-4 pr-1 mt-0.5 min-w-0">
            <span class="text-[11px] truncate min-w-0">
              {#if group}<span class="text-foreground/60" title="Group: {group.name}" data-row-group>{group.name}</span>{#if showProject || subtitle}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}
              {#if showProject}
                <!-- A grove character carries the project colour on its laptop, so the square is only needed with the plain dot. -->
                {#if repoColor && !settingsStore.current.groveCharacters}<span class="inline-block w-1.5 h-1.5 align-middle mr-1" style="background-color: {repoColor}"></span>{/if}<span class="text-muted-foreground/70">{store.repoDisplayName(session.repoPath)}</span>{#if subtitle}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}{#if subtitle}<span class={SUBTITLE_TONE_CLASS[subtitle.tone]}>{subtitle.text}</span>{/if}
            </span>
            {#if changedCount > 0}
              <span
                class="ml-auto shrink-0 text-[10px] text-muted-foreground/60 border border-border/60 px-1 leading-4"
                title="{changedCount} changed file{changedCount === 1 ? '' : 's'} in the worktree"
              >±{changedCount}</span>
            {/if}
          </div>
        {/if}
      </button>
      {#if !isDestroying}
        {#if !store.isOpenTab(session)}
          <!-- Closed session: delete (removes the worktree, after asking). -->
          <button
            type="button"
            title="Delete conversation"
            aria-label="Delete conversation {label}"
            onclick={() => requestDestroy(session.id)}
            class="absolute top-1.5 right-2 w-5 h-5 flex items-center justify-center text-muted-foreground transition-colors
              hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100"
          >
            <!-- A bin, not an ✕: ✕ reads as "close", and this deletes. -->
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        {:else}
          <!-- Open session (live, or restored and waiting to reconnect, like the
               context menu): close it (stops the agent but keeps it resumable). -->
          <button
            type="button"
            title={'Close conversation\nStops the agent and terminal and moves it under Projects. Open it again any time.'}
            aria-label="Close conversation {label}"
            onclick={() => stopSession(session.id)}
            class="absolute top-1.5 right-2 w-5 h-5 flex items-center justify-center text-muted-foreground transition-colors
              hover:text-foreground hover:bg-sidebar-accent opacity-0 group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        {/if}
      {/if}
    </div>
  {/snippet}

  <!-- Sort toggle, shared by the Conversations list and the Projects tree -->
  {#snippet sortButton(key: SessionSortState['key'], label: string)}
    {@const sort = store.sessionSort}
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

  {#if collapsed}
    <!-- Rail: expand, search, the open conversations, the footer's buttons -->
    <div class="flex flex-col items-center gap-1 pt-3 pb-2 shrink-0 border-b border-sidebar-border" data-rail>
      <PanelToggle panel="sidebar" label="sidebar" />
      <button
        onclick={() => store.finderOpen = true}
        class="p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent transition-colors"
        title="Search conversations (Ctrl+R)"
        aria-label="Search conversations"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto overflow-x-hidden py-2">
      {#if draftStore.draft}
        <button
          type="button"
          onclick={() => draftStore.show()}
          class="w-full flex justify-center py-2 transition-colors {draftStore.visible ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
          title="New conversation, not started yet"
          aria-label="New conversation, not started yet"
        >
          <span class="w-2 h-2 border border-dashed border-muted-foreground"></span>
        </button>
      {/if}
      <!-- Every open conversation: the triage filter isn't on the rail to explain a shorter list. -->
      {#each store.openConversations as session (session.id)}
        {@const isDestroying = destroying.has(session.id)}
        {@const isSleeping = sessionSpriteState(session, isDestroying) === 'sleeping'}
        {@const subtitle = rowSubtitle(session)}
        {@const name = `${store.repoDisplayName(session.repoPath)} / ${sessionRowLabel(session)}`}
        <button
          onclick={() => { if (!isDestroying) focusSession(session.id); }}
          oncontextmenu={(e) => { if (isDestroying) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
          disabled={isDestroying}
          title={subtitle ? `${name}\n${subtitle.text}` : name}
          aria-label={name}
          data-rail-session={session.id}
          class="w-full flex justify-center py-2 transition-colors
            {isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}
            {isSleeping ? 'opacity-70' : ''}"
        >
          {@render statusMark(session, isDestroying, getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors))}
        </button>
      {/each}
    </div>
    <div class="py-3 border-t border-sidebar-border flex flex-col items-center gap-1 shrink-0">
      <Button
        onclick={() => openNewAgent()}
        disabled={!store.canCreate}
        size="sm"
        class="px-2"
        title="New conversation (Ctrl+N)"
        aria-label="New conversation"
      >
        <MessageSquarePlusIcon aria-hidden="true" />
      </Button>
      <div class="w-8"><AddRepoButton compact /></div>
      {@render footerTools()}
    </div>
  {/if}

  <!-- Search: opens the session finder (titles + full conversation content) -->
  <div class="px-3 pt-3 {collapsed ? 'hidden' : 'flex'} items-center gap-1">
    <button
      onclick={() => store.finderOpen = true}
      class="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 bg-sidebar-accent/40 border border-sidebar-border text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent transition-colors"
      title="Search conversations (Ctrl+R)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <span class="text-xs truncate">Search conversations…</span>
      <span class="ml-auto text-[10px] text-muted-foreground/40 shrink-0">Ctrl+R</span>
    </button>
    <PanelToggle panel="sidebar" label="sidebar" class="-mr-1" />
  </div>

  <div class="flex-1 overflow-auto px-3 py-3 {collapsed ? 'hidden' : ''}">
    <!-- Triage filter: what needs me, what is working, what finished while I was away.
         Click a chip to show only those; click it again to show all. -->
    <div class="flex items-center gap-1 mb-2 px-1" role="group" aria-label="Filter conversations">
      {#each CHIP_FILTERS as f (f)}
        {@const n = counts[f]}
        {@const active = triageFilter === f}
        <button
          type="button"
          onclick={() => toggleFilter(f)}
          aria-pressed={active}
          aria-label="{TRIAGE_FILTER_LABELS[f]} {n}"
          class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] border transition-colors
            {active ? 'border-border bg-sidebar-accent text-foreground' : 'border-transparent text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent/50'}
            {n === 0 ? 'opacity-50' : ''}"
          title="{TRIAGE_FILTER_LABELS[f]}: {n}{active ? '. Click again to show all' : ''}"
        >
          <span class="w-1.5 h-1.5 shrink-0 {TRIAGE_DOT[f]}"></span>
          <!-- Narrow sidebar: dot and count only, the label is in the tooltip. -->
          {#if !compact}{TRIAGE_FILTER_LABELS[f]}{/if}
          <span class="text-muted-foreground/50">{n}</span>
        </button>
      {/each}
    </div>

    <!-- CONVERSATIONS: the live working set, always visible at the top. The sort
         applies to the Projects tree too. -->
    <div class="flex items-center justify-between mb-1 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Conversations</span>
      <div class="flex items-center" role="group" aria-label="Sort conversations">
        {@render sortButton('name', 'Name')}
        {@render sortButton('age', 'Age')}
      </div>
    </div>

    {#if draftStore.draft}
      {@const draft = draftStore.draft}
      {@const draftGroup = draftStore.groupName}
      <!-- The draft conversation: not started, so nothing exists yet. -->
      <button
        type="button"
        onclick={() => draftStore.show()}
        class="w-full flex flex-col pl-4 pr-2 py-1.5 text-left transition-colors {draftStore.visible ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
        title="New conversation, not started yet"
      >
        <span class="w-full flex items-center gap-2 min-w-0">
          <span class="w-2 h-2 shrink-0 border border-dashed border-muted-foreground"></span>
          <span class="text-sm truncate min-w-0 flex-1 italic text-muted-foreground">{draft.text.trim() ? draft.text.trim().split('\n')[0] : 'New conversation'}</span>
          <span class="text-[10px] text-muted-foreground/50 shrink-0">draft</span>
        </span>
        {#if store.repos.length > 1 || draftGroup}
          <span class="pl-4 mt-0.5 text-[11px] text-muted-foreground/70 truncate">{#if draftGroup}<span class="text-foreground/60">{draftGroup}</span>{#if store.repos.length > 1}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}{#if store.repos.length > 1}{store.repoDisplayName(draft.repoPath)}{/if}</span>
        {/if}
      </button>
    {/if}
    {#each activeSessions as session (session.id)}
      <!-- The project name only helps when there is more than one. -->
      {@render sessionRow(session, store.repos.length > 1, null, true)}
    {/each}
    {#if activeSessions.length === 0 && !draftStore.draft}
      <p class="text-xs text-muted-foreground/50 pl-4 py-1">{triageFilter === 'all' ? 'No conversations' : `No conversations match "${TRIAGE_FILTER_LABELS[triageFilter]}"`}</p>
    {/if}

    <!-- GROUPS: conversations across projects that belong to one piece of work -->
    <SidebarGroups
      row={sessionRow}
      {rowVisible}
      countsFor={headerCounts}
      closeConversation={(id) => void stopSession(id)}
      filterLabel={triageFilter === 'all' ? null : TRIAGE_FILTER_LABELS[triageFilter]}
    />

    <!-- PROJECTS: every repo with its sessions (stopped ones actionable); hosts repo management -->
    <div class="flex items-center justify-between mt-5 mb-2 px-1">
      <span class="text-xs text-muted-foreground uppercase tracking-wide">Projects</span>
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground/50">
        {#if closedCount}
          <span>{closedCount} closed</span>
        {/if}
      </div>
    </div>

    {#each store.repos as repo (repo)}
      {@const repoColor = getRepoColor(store.repos, repo, settingsStore.current.repoColors)}
      {@const branchGroups = getBranchGroups(repo)}
      {@const rowCount = branchGroups.reduce((n, [, s]) => n + s.length, 0)}
      {@const repoCollapsed = isRepoCollapsed(collapsedRepos, repo)}
      <div class="mb-3">
        <!-- Repo header (click to collapse/expand the repo's conversation tree) -->
        <div class="flex items-center justify-between group px-1 py-1">
          <button
            type="button"
            onclick={() => toggleRepoCollapsed(repo)}
            aria-expanded={!repoCollapsed}
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-foreground transition-colors"
            title={repoCollapsed ? 'Expand project' : 'Collapse project'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted-foreground/60 transition-transform" style={repoCollapsed ? 'transform: rotate(-90deg)' : ''}><path d="m6 9 6 6 6-6"/></svg>
            {#if repoColor}
              <span class="w-2 h-2 shrink-0" style="background-color: {repoColor}"></span>
            {/if}
            <span class="text-xs font-medium text-muted-foreground truncate" title={repo}>
              {store.repoDisplayName(repo)}
            </span>
            {#if rowCount}
              <span class="text-xs text-muted-foreground/40 shrink-0">{rowCount}</span>
            {/if}
            <!-- Per-repo attention counts, same dots as the filter chips -->
            <AttentionCounts counts={repoCounts(repo)} />
          </button>
          <div class="flex items-center gap-0.5">
            <!-- A bin, like a conversation's delete: removing a project deletes its conversations too (it asks first).
                 Before the +: it only shows on hover, and on the outside it left a gap at the row's edge. -->
            <button
              onclick={() => requestRemoveRepo(repo)}
              class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title="Remove project"
              aria-label="Remove project {store.repoDisplayName(repo)}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
            <!-- Always shown: this is the main way to start a conversation in a project. -->
            <button
              onclick={() => openNewAgent(repo)}
              class="w-5 h-5 flex items-center justify-center text-muted-foreground/70 hover:text-primary hover:bg-sidebar-accent transition-colors"
              title="New conversation in {store.repoDisplayName(repo)}"
              aria-label="New conversation in {store.repoDisplayName(repo)}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </button>
          </div>
        </div>

        <!-- The project's conversations, grouped by branch -->
        {#if !repoCollapsed}
          {#each branchGroups as [branch, sessions] (branch)}
            {#if sessions.length === 1}
              {@render sessionRow(sessions[0], false, null, true)}
            {:else}
              {@const branchCollapsed = !!collapsedBranches[branchKey(repo, branch)]}
              <div class="pl-3 mt-0.5">
                <button
                  type="button"
                  onclick={() => toggleBranchCollapsed(repo, branch)}
                  aria-expanded={!branchCollapsed}
                  class="w-full flex items-center gap-1.5 px-1 py-0.5 text-left text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 transition-transform" style={branchCollapsed ? 'transform: rotate(-90deg)' : ''} aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  <span class="truncate" title={branch}>{branch}</span>
                  <span class="text-muted-foreground/40">({sessions.length})</span>
                </button>
                {#if !branchCollapsed}
                  {#each sessions as session, i (session.id)}
                    {@render sessionRow(session, false, session.displayName || `conversation ${i + 1}`, true)}
                  {/each}
                {/if}
              </div>
            {/if}
          {/each}

          {#if branchGroups.length === 0}
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
  <div class="px-3 py-3 border-t border-sidebar-border {collapsed ? 'hidden' : 'flex'} flex-col gap-2">
    <div class="flex gap-2">
      <div class="flex-1 min-w-0">
        <AddRepoButton {compact} />
      </div>
      <Button
        onclick={() => openNewAgent()}
        disabled={!store.canCreate}
        class="flex-1"
        size="sm"
        title="New conversation (Ctrl+N)"
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
      {@render footerTools()}
    </div>
  </div>

  <!-- Resize handle: drag to adjust sidebar width (persisted) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={startResize}
    class="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10 -mr-0.5 {collapsed ? 'hidden' : ''}
      {resizing ? 'bg-primary/40' : 'hover:bg-primary/25'} transition-colors"
    title="Drag to resize sidebar"
  ></div>
</aside>


{#if settingsOpened}
  {#await loadSettingsPanel() then SettingsPanel}
    <SettingsPanel open={settingsStore.panelOpen} onclose={() => settingsStore.panelOpen = false} />
  {/await}
{/if}
{#if memoryOpened}
  {#await loadMemoryPanel() then MemoryPanel}
    <MemoryPanel open={memoryStore.panelOpen} onclose={() => memoryStore.panelOpen = false} />
  {/await}
{/if}

{#if contextMenu}
  <ContextMenu
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
          Remove closed conversations you no longer need. Removing a conversation kills its shell and deletes its worktree. Conversations with uncommitted changes are flagged and left unselected — tick them only if you're sure. Each conversation's pull request state is shown when the GitHub CLI is available; merged ones are the safest to remove. Branches are kept unless you choose otherwise. Running conversations are never listed.
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
        <p class="text-sm text-muted-foreground/50 py-2">No closed conversations inactive for {cleanupDaysNum} days.</p>
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
              <!-- Says what it leaves out, so "all" never means less than all. -->
              {cleanupDirtyCount > 0 ? `Select all except ${cleanupDirtyCount} with changes` : 'Select all'}
            </button>
            {#if cleanupGhAvailable}
              <span class="text-muted-foreground/40" aria-hidden="true">·</span>
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
                  {#if cleanupStatusUnknown[session.id]}
                    <span class="text-amber-500 font-medium" title="Git couldn't read this worktree's status, so it may have uncommitted changes">· changes unknown</span>
                  {:else if cleanupDirty[session.id]}
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

<!-- Delete conversation confirmation dialog -->
{#if confirmDestroyId}
  {@const session = store.sessions.find(s => s.id === confirmDestroyId)}
  {@const branch = session?.branch ?? 'unknown'}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmDestroyId = null; }}>
    <Dialog.Content class="max-w-sm">
      <Dialog.Header>
        <Dialog.Title>Delete conversation?</Dialog.Title>
        <Dialog.Description>
          {#if session?.noGit}
            This stops the conversation and removes it. It worked in the project folder itself, so no files are deleted.
          {:else if session?.direct}
            This stops the conversation and removes it. It worked in the project folder on
            <span class="text-foreground font-medium">{branch}</span>, so no files are deleted.
          {:else}
            This removes the conversation and its copy of the project (the worktree for
            <span class="text-foreground font-medium">{branch}</span>).
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      {#if !session?.direct}
        {#if destroyUncommitted}
          <p class="text-xs text-yellow-500 mt-3" role="alert">
            {destroyUncommitted} {destroyUncommitted === 1 ? 'file has' : 'files have'} uncommitted changes that will be lost.
          </p>
        {/if}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={deleteBranchOnDestroy} />
          Also delete the branch
        </label>
        {#if deleteBranchOnDestroy && destroyUnmerged?.count}
          <p class="text-xs text-yellow-500 mt-2" role="alert">
            {destroyUnmerged.count} {destroyUnmerged.count === 1 ? 'commit' : 'commits'} on {branch}
            {destroyUnmerged.count === 1 ? "isn't" : "aren't"} on {destroyUnmerged.base} yet. Unless you've pushed
            {destroyUnmerged.count === 1 ? 'it' : 'them'}, deleting the branch can lose {destroyUnmerged.count === 1 ? 'it' : 'them'}.
          </p>
        {/if}
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmDestroyId = null}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={confirmDestroy} disabled={destroyChecking}>
          {destroyChecking ? 'Checking…' : 'Delete'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Remove project confirmation: deletes its conversations too, with the same checks as deleting one -->
{#if confirmRemoveRepo}
  {@const repoSessions = store.sessions.filter((s) => removeRepoIds.includes(s.id))}
  {@const n = repoSessions.length}
  {@const hasWorktrees = repoSessions.some((s) => !s.direct)}
  {@const running = repoSessions.filter((s) => s.status === 'running' || s.status === 'starting' || s.status === 'installing')}
  {@const midTurn = running.filter((s) => messageStore.getIsRunning(s.id)).length}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o && !removingRepo) confirmRemoveRepo = null; }}>
    <Dialog.Content class="max-w-sm">
      <Dialog.Header>
        <Dialog.Title>Remove project?</Dialog.Title>
        <Dialog.Description>
          Remove <span class="text-foreground font-medium">{store.repoDisplayName(confirmRemoveRepo)}</span> from Grove Bench?
          {#if n > 0}
            This also deletes its {n} {n === 1 ? 'conversation' : 'conversations'}{hasWorktrees ? ' and their copies of the project (worktrees)' : ''}.
          {/if}
          The project folder itself isn't touched.
        </Dialog.Description>
      </Dialog.Header>
      {#if removeRepoRechecked}
        <p class="text-xs text-muted-foreground mt-3">New conversations started in this project, so it checked again.</p>
      {/if}
      {#if running.length}
        <p class="text-xs text-yellow-500 mt-3" role="alert">
          {running.length} {running.length === 1 ? 'conversation is' : 'conversations are'} running and will be stopped{midTurn ? `, ${midTurn} in the middle of a turn` : ''}.
        </p>
      {/if}
      {#if removeRepoDirty}
        <p class="text-xs text-yellow-500 mt-3" role="alert">
          {removeRepoDirty} {removeRepoDirty === 1 ? 'conversation has' : 'conversations have'} uncommitted changes that will be lost.
        </p>
      {/if}
      {#if hasWorktrees}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={removeRepoDeleteBranches} disabled={removingRepo} />
          Also delete their branches
        </label>
        {#if removeRepoDeleteBranches && removeRepoUnmerged?.count}
          <p class="text-xs text-yellow-500 mt-2" role="alert">
            {removeRepoUnmerged.count} {removeRepoUnmerged.count === 1 ? "branch has commits that aren't" : "branches have commits that aren't"} on {removeRepoUnmerged.base} yet.
            Unless you've pushed them, deleting the branches can lose them.
          </p>
        {/if}
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmRemoveRepo = null} disabled={removingRepo}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={confirmRemoveProject} disabled={removeRepoChecking || removingRepo}>
          {removingRepo ? 'Removing…' : removeRepoChecking ? 'Checking…' : 'Remove'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
