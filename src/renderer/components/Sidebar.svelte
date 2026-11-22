<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { followUpsStore } from '../stores/followUps.svelte.js';
  import { trackEvent } from '../lib/analytics.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { addProject } from '../lib/add-project.js';
  import { backgroundAgentRunning } from '../lib/thread-working.js';
  import { backgroundShells, describeShells } from '../lib/background-shells.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { groupStore } from '../stores/groups.svelte.js';
  import { todoStore } from '../stores/todo.svelte.js';
  import { cleanupStore } from '../stores/cleanup.svelte.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
  import ListTodoIcon from '@lucide/svelte/icons/list-todo';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import Link2Icon from '@lucide/svelte/icons/link-2';
  import { linkedStore } from '../stores/linked.svelte.js';
  import ListIcon from '@lucide/svelte/icons/list';
  import SquareKanbanIcon from '@lucide/svelte/icons/square-kanban';
  import { boardStore } from '../stores/board.svelte.js';
  import CheckIcon from '@lucide/svelte/icons/check';
  import XIcon from '@lucide/svelte/icons/x';
  import MinusIcon from '@lucide/svelte/icons/minus';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import SidebarGroups from './SidebarGroups.svelte';
  import SidebarSection from './SidebarSection.svelte';
  import AttentionCounts from './AttentionCounts.svelte';
  import TodoMark from './TodoMark.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import { unsavedFileCount } from '../lib/unsaved-files.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import { memoryStore } from '../stores/memory.svelte.js';
  import ContextMenu from './ContextMenu.svelte';
  import { formatAge } from '../../shared/format-age.js';
  import { isRepoCollapsed } from '../lib/repo-collapse.js';
  import { sortSessions, defaultDirFor } from '../lib/session-sort.js';
  import { triageForSprite, triageCounts, matchesTriageFilter, TRIAGE_FILTERS, TRIAGE_FILTER_LABELS, type TriageFilter, type TriageEntry } from '../lib/session-triage.js';
  import type { SessionSubtitle } from '../lib/session-subtitle.js';
  import { threadSubtitle as rowSubtitle, SUBTITLE_TONE_CLASS } from '../lib/thread-subtitle.js';
  import { threadLabel as sessionRowLabel } from '../lib/thread-label.js';
  import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
  import { goalStore } from '../stores/goals.svelte.js';
  import { prStateFlag, isPrMerged } from '../lib/pr-state.js';
  import { prStore, type BranchShip } from '../stores/pr.svelte.js';
  import type { ShipStage } from '../lib/ship-track.js';
  import ShipIcon from './ShipIcon.svelte';
  import { forgetConversation } from '$lib/forget-conversation.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import AgentSprite from './AgentSprite.svelte';
  import StatusDot from './StatusDot.svelte';
  import { mapLimit } from '../lib/map-limit.js';
  import PanelToggle from './PanelToggle.svelte';
  import { panelStore } from '../stores/panels.svelte.js';
  import type { LinkedProjectStatus, SessionSortState, SessionStatus, PrInfo } from '../../shared/types.js';
  import { limitedQueue } from '../lib/limited-queue.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { splitSkillLine } from '../../shared/skill-line.js';
  import { deriveSessionName } from '../../shared/session-name.js';
  import { onMount, untrack } from 'svelte';
  import { errorMessage } from '../../shared/error-message.js';

  /** The draft's row: its first line, or for a skill run the name the
   *  thread will get ("triage: Fix the login bug"), not the line every one
   *  starts with. */
  function draftTitle(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return 'New thread';
    return (splitSkillLine(trimmed) && deriveSessionName(trimmed)) || trimmed.split('\n')[0];
  }

  // Per-repo accordion collapse state, persisted via app-state. An explicit
  // entry wins; otherwise repos default to collapsed (see isRepoCollapsed).
  // Loaded on mount; the empty map renders the correct default immediately, so
  // there's no flash of expanded content.
  let collapsedRepos = $state<Record<string, boolean>>({});

  // User-resizable sidebar width (px), persisted via app-state.
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 300;
  // Below this width the first three filter chips' labels no longer fit on
  // one line, so the chips show just their dot and count. Idle wraps onto a
  // second line until the sidebar is about 336px wide, and To do after it.
  const SIDEBAR_COMPACT_BELOW = 280;
  let sidebarWidth = $state(SIDEBAR_DEFAULT);
  let compact = $derived(sidebarWidth < SIDEBAR_COMPACT_BELOW);
  let resizing = $state(false);
  // Folded down to a rail: the open conversations' status marks and the
  // footer's buttons. The full sidebar stays mounted (hidden) so its scroll
  // position and filters are still there when it opens again.
  const RAIL_WIDTH = 48;
  let collapsed = $derived(panelStore.isCollapsed('sidebar'));
  // The Groups and Projects sections, each folded down to its heading.
  let groupsCollapsed = $derived(panelStore.isCollapsed('groupsSection'));
  let projectsCollapsed = $derived(panelStore.isCollapsed('projectsSection'));

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
    if (unloaded.length > 0) void sessionPreviewStore.ensure(unloaded);
  });

  // Goals for the rows' tooltips, while goals are on: one call for every
  // thread not read yet.
  $effect(() => {
    if (!settingsStore.current.showConversationGoal) return;
    const ids = store.sessions.map((s) => s.id);
    untrack(() => { void goalStore.loadMany(ids); });
  });

  /** A row's tooltip: its name, its goal (while goals are on and the
   *  thread's goal bar isn't hidden), the line under the row, then the
   *  shells and monitors its agent left running (describeShells' tooltip). */
  function rowTitle(sessionId: string, name: string, subtitle: SessionSubtitle | null, shellsTooltip: string | undefined): string {
    const lines = [name];
    const goal = goalStore.get(sessionId);
    if (settingsStore.current.showConversationGoal && goal.text && !goal.hidden) lines.push(`Goal: ${goal.text}`);
    if (subtitle) lines.push(subtitle.text);
    if (shellsTooltip) lines.push(shellsTooltip);
    return lines.join('\n');
  }

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
    icon: 'rename' | 'folder' | 'export' | 'destroy' | 'add' | 'close' | 'ungroup' | 'todo' | 'unread' | 'read' | 'link';
    action: () => void;
    variant?: 'destructive';
    separator?: boolean;
  }

  function getContextMenuItems(sessionId: string): MenuItem[] {
    const session = store.sessions.find(s => s.id === sessionId);
    if (!session) return [];
    const followUp = followUpMenuItems(session);
    const items: MenuItem[] = [
      ...followUp,
      { label: 'Rename', icon: 'rename', action: () => startRename(sessionId, sessionLabel(session)), separator: followUp.length > 0 },
      { label: 'Open Folder', icon: 'folder', action: () => void window.groveBench.openSessionFolder(sessionId) },
      { label: 'Export Thread…', icon: 'export', action: () => void exportThread(sessionId) },
    ];
    // Another project to work in, through a worktree of its own.
    if (linkedStore.canLink(sessionId)) {
      items.push({ label: 'Work in Another Project…', icon: 'link', action: () => linkedStore.openLinkDialog(sessionId) });
    }
    // Close Conversation stops a live session (it was called Stop, then Mark
    // Completed) but keeps it resumable from Ctrl+R; not shown for
    // already-stopped ones. For an open tab still waiting to reconnect it
    // just closes the tab.
    if (store.isOpenTab(session)) {
      items.push({ label: 'Close Thread', icon: 'close', action: () => requestClose([sessionId]) });
    }
    items.push(...groupMenuItems(sessionId));
    items.push({ label: 'Delete Thread', icon: 'destroy', action: () => requestDestroy(sessionId), variant: 'destructive', separator: true });
    return items;
  }

  /** Flags for coming back to a thread. To do stays until it is cleared;
   *  unread goes when the thread is next opened (marking the open thread
   *  unread keeps it so until then). */
  function followUpMenuItems(session: (typeof store.sessions)[number]): MenuItem[] {
    const sessionId = session.id;
    const items: MenuItem[] = [];
    // Until the saved flags are read, changing them could write over them.
    if (todoStore.ready) {
      items.push(todoStore.has(sessionId)
        ? { label: 'Clear To Do', icon: 'todo', action: () => todoStore.set(sessionId, false) }
        : { label: 'Mark as To Do', icon: 'todo', action: () => todoStore.set(sessionId, true) });
    }
    if (store.isUnread(session)) {
      items.push({ label: 'Mark as Read', icon: 'read', action: () => store.clearNeedsAttention(sessionId) });
    } else if (session.status !== 'error' && store.isOpenTab(session)) {
      // Not on a red thread, which stays red, nor a closed one, which counts
      // as dealt with. A working or waiting one shows it once that's over.
      items.push({ label: 'Mark as Unread', icon: 'unread', action: () => store.markNeedsAttention(sessionId) });
    }
    return items;
  }

  /** Save the thread to a file (main asks where, and Markdown or JSON). */
  async function exportThread(sessionId: string) {
    try {
      await window.groveBench.exportThread(sessionId);
    } catch (e) {
      store.setError(`Couldn't export the thread: ${stripIpcErrorPrefix(e instanceof Error ? e.message : String(e))}`);
    }
  }

  /** Group actions for a conversation: leave its group, join another, or
   *  start a new one with it. */
  function groupMenuItems(sessionId: string): MenuItem[] {
    // Until the saved groups are read, changing them could write over them.
    if (!groupStore.ready) return [];
    const current = groupStore.groupOf(sessionId);
    const items: MenuItem[] = [];
    if (current) {
      items.push({ label: `Remove from ${current.name}`, icon: 'ungroup', action: () => groupStore.remove(sessionId) });
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
  /** A removal run is under way (cleanupStore): it carries on with the
   *  dialog closed, and the dialog shows its progress when opened. */
  const cleaningUp = $derived(cleanupStore.running);
  /** Share of the run's threads finished with, for its progress bar. */
  const cleanupProgressPct = $derived(cleanupStore.total ? Math.round((cleanupStore.settled / cleanupStore.total) * 100) : 0);
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
  /** sessionId → how many commits its branch has that its base branch
   *  doesn't, with that base; null when git couldn't tell. Checked only
   *  once "Also delete their branches" is ticked: main force-deletes the
   *  branches Grove made, so those commits go with them unless pushed (the
   *  Delete dialog warns the same). Absent = not checked, or still checking. */
  let cleanupUnmerged = $state<Record<string, { count: number; base: string } | null>>({});
  /** Candidates whose checks have started this dialog session (not reactive:
   *  read inside the effect without becoming a dependency). */
  const cleanupCheckedIds = new Set<string>();
  /** Same, for the commits check. */
  const cleanupCommitsCheckedIds = new Set<string>();
  /** Bumped each time the dialog opens so results from a previous open are dropped. */
  let cleanupGeneration = 0;
  /** Shared by every run of the check effect, so editing the cutoff queues
   *  more rows instead of starting more processes. Separate queues, so a
   *  slow gh never holds up the uncommitted-changes checks. */
  const cleanupStatusQueue = limitedQueue(CLEANUP_CONCURRENCY);
  const cleanupPrQueue = limitedQueue(CLEANUP_CONCURRENCY);
  const cleanupCommitsQueue = limitedQueue(CLEANUP_CONCURRENCY);
  // Closing the dialog drops the checks not started; opening it starts over.
  $effect(() => {
    if (showCleanup) return;
    cleanupStatusQueue.clear();
    cleanupPrQueue.clear();
    cleanupCommitsQueue.clear();
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
  /** The preset the field matches, for the preset picker ('' when none does). */
  const cleanupPresetValue = $derived(cleanupDaysNum !== null && cleanupDayPresets.includes(cleanupDaysNum) ? String(cleanupDaysNum) : '');
  /** Identity of the candidate set. The check effect keys off this rather
   *  than the array, so an unrelated store update (another session's status
   *  changing, a rename) doesn't reset the user's ticks or re-run the checks. */
  const cleanupCandidateKey = $derived(cleanupCandidates.map((s) => s.id).join('\n'));
  const cleanupSelectedIds = $derived(cleanupCandidates.map((s) => s.id).filter((id) => cleanupSelection[id]));
  const cleanupSelectedDirtyCount = $derived(cleanupSelectedIds.filter((id) => cleanupDirty[id]).length);
  const cleanupSelectedTodoCount = $derived(cleanupSelectedIds.filter((id) => todoStore.has(id)).length);
  /** Listed candidates known to have uncommitted changes: "Select all" leaves these out. */
  const cleanupDirtyCount = $derived(cleanupCandidates.filter((s) => cleanupDirty[s.id]).length);
  /** Listed candidates marked To do, not counted above: left out too. */
  const cleanupTodoCount = $derived(cleanupCandidates.filter((s) => todoStore.has(s.id) && !cleanupDirty[s.id]).length);
  /** Says what it leaves out, so "all" never means less than all. */
  const cleanupSelectAllLabel = $derived.by(() => {
    const left = [
      cleanupDirtyCount > 0 ? `${cleanupDirtyCount} with changes` : '',
      cleanupTodoCount > 0 ? `${cleanupTodoCount} to do` : '',
    ].filter(Boolean);
    return left.length ? `Select all except ${left.join(' and ')}` : 'Select all';
  });
  /** Selected threads whose branch goes if branches are deleted (a direct
   *  thread keeps its branch). */
  const cleanupSelectedBranchIds = $derived(cleanupCandidates.filter((s) => cleanupSelection[s.id] && !s.direct).map((s) => s.id));
  /** Remove waits for the commits check of every selected thread whose
   *  branch is about to go, so a quick click can't skip its warning. */
  const cleanupCommitsPending = $derived(cleanupDeleteBranches && cleanupSelectedBranchIds.some((id) => !(id in cleanupUnmerged)));
  const cleanupSelectedUnmergedCount = $derived(cleanupSelectedBranchIds.filter((id) => (cleanupUnmerged[id]?.count ?? 0) > 0).length);
  const cleanupSelectedCommitsUnknown = $derived(cleanupSelectedBranchIds.filter((id) => cleanupUnmerged[id] === null).length);
  const cleanupMergedCount = $derived(cleanupCandidates.filter((s) => isPrMerged(cleanupPrOf(s.id))).length);
  const cleanupGhAvailable = $derived(store.prerequisites?.gh?.available === true);

  /** Whether a candidate is left unticked unless the user ticks it: one
   *  with uncommitted changes (removing it loses work), or one marked To do
   *  (put aside to come back to). Undefined while its check still runs. */
  function cleanupKeptBack(id: string): boolean | undefined {
    return todoStore.has(id) || cleanupDirty[id];
  }

  function cleanupPrOf(id: string): PrInfo | null {
    const pr = cleanupPr[id];
    return pr && pr !== 'unknown' ? pr : null;
  }

  function openCleanup() {
    // A run under way: show its progress, with the choices it was started with.
    if (cleaningUp) {
      showCleanup = true;
      return;
    }
    cleanupGeneration++;
    cleanupCheckedIds.clear();
    cleanupCommitsCheckedIds.clear();
    cleanupDirty = {};
    cleanupStatusUnknown = {};
    cleanupPr = {};
    cleanupUnmerged = {};
    cleanupSelection = {};
    cleanupStatusQueue.clear();
    cleanupPrQueue.clear();
    cleanupCommitsQueue.clear();
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
      // Tick it unless it is kept back, or the user already decided about it.
      if (cleanupSelection[id] === undefined) cleanupSelection = { ...cleanupSelection, [id]: !cleanupKeptBack(id) };
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
            // Its linked projects' worktrees go with it.
            const links = await linkedDirty(s);
            if (links === null) unknown = true;
            dirty = dirty || links !== false;
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

  // Once "Also delete their branches" is ticked (and for threads listed
  // later while it is): check each newly listed thread's branch for commits
  // its base branch doesn't have, as the Delete dialog does. Skipped until
  // then, since keeping the branches keeps the commits. Direct threads keep
  // their branch, so they are never checked.
  $effect(() => {
    if (!showCleanup || !cleanupDeleteBranches) return;
    void cleanupCandidateKey; // as above: the candidate set, not the array
    const fresh = untrack(() => cleanupCandidates).filter((s) => !s.direct && !cleanupCommitsCheckedIds.has(s.id));
    if (fresh.length === 0) return;
    for (const s of fresh) cleanupCommitsCheckedIds.add(s.id);
    const generation = cleanupGeneration;
    const timeout = { timeout: DELETE_CHECK_TIMEOUT_MS };
    // One lookup per project, shared by its threads.
    const bases = new Map<string, Promise<string>>();
    const baseFor = (repoPath: string) => {
      let base = bases.get(repoPath);
      if (!base) bases.set(repoPath, base = resolveBaseBranch(repoPath));
      return base;
    };
    untrack(() => {
      for (const s of fresh) {
        cleanupCommitsQueue.add(async () => {
          let answer: { count: number; base: string } | null;
          try {
            const base = await baseFor(s.repoPath);
            const result = await withTimeout(window.groveBench.getBranchCommits(s.id, base, timeout), DELETE_CHECK_GIVE_UP_MS);
            answer = result.error ? null : { count: result.commits.length, base };
          } catch {
            answer = null;
          }
          if (generation === cleanupGeneration) cleanupUnmerged = { ...cleanupUnmerged, [s.id]: answer };
        });
      }
    });
  });

  /** Tick every candidate that isn't kept back (the initial state). Ones
   *  still being checked are left undecided, so they are ticked if their
   *  check comes back clean. */
  function cleanupSelectAllClean() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) {
      const kept = cleanupKeptBack(s.id);
      if (kept !== undefined) sel[s.id] = !kept;
    }
    cleanupSelection = sel;
  }

  /** Tick only candidates whose PR has been merged. Their work has landed,
   *  so they are the safest to remove. Kept-back ones stay unticked, same as
   *  the initial preselection. */
  function cleanupSelectMerged() {
    const sel: Record<string, boolean> = {};
    for (const s of cleanupCandidates) {
      const merged = isPrMerged(cleanupPrOf(s.id));
      const kept = cleanupKeptBack(s.id);
      // A merged one still being checked is ticked once it comes back clean.
      if (merged && kept === undefined) continue;
      sel[s.id] = merged && kept === false;
    }
    cleanupSelection = sel;
  }

  async function runCleanup() {
    confirmCleanup = false;
    if (cleaningUp) return;
    const deleteBranches = cleanupDeleteBranches;
    const items = cleanupStore.start(cleanupCandidates
      .filter((s) => cleanupSelection[s.id])
      .map((s) => ({ id: s.id, label: sessionRowLabel(s), project: repoShortName(s.repoPath) })));
    // One at a time, and a failure doesn't stop the rest: its thread stays,
    // so the next clean-up lists it again. The dialog may close meanwhile;
    // the run carries on, and the toast says how it went (failures included,
    // so they aren't also shown as the app's error).
    for (const item of items) {
      // Checked again just before its turn, since the dialog can be closed
      // meanwhile: one opened again since (it is showing, running, or
      // waiting to reconnect) is in use, so it is left alone; one deleted
      // meanwhile is already gone.
      const session = store.sessions.find((s) => s.id === item.id);
      if (!session) {
        item.state = 'done';
        continue;
      }
      if (store.activeSessionId === item.id || store.isOpenTab(session)) {
        item.state = 'skipped';
        continue;
      }
      item.state = 'removing';
      const removed = await destroySessionById(item.id, deleteBranches, (message) => { item.error = message; });
      item.state = removed ? 'done' : 'failed';
    }
    cleanupStore.finish();
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

  /** Open a thread, or deselect it when it is the one open: back to the
   *  landing screen, or to the draft if there is one. `clicks` is the
   *  event's click count: a double-click's second click doesn't deselect
   *  the thread its first one opened. */
  function toggleSession(id: string, clicks: number) {
    if (store.activeSessionId === id) {
      if (clicks < 2) store.activeSessionId = null;
      return;
    }
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

  /** What closing does: the quick ✕'s tooltip, and its description for
   *  screen readers (which already read its name, so it isn't repeated). */
  const CLOSE_HINT = 'Stops the agent and terminal and takes it off the Threads list. Open it again any time.';

  /** Conversations waiting on the close confirmation, as they were when it
   *  was asked: how many were mid-turn, how many more had a background agent
   *  running, and whether any had one. */
  type CloseAsk = { ids: string[]; midTurn: number; agentOnly: number; agents: boolean };
  let confirmClose = $state<CloseAsk | null>(null);

  /** Close conversations, asking first when any is working (mid-turn, or a
   *  background agent still running): closing cuts that work off, and the ✕
   *  is easy to click in passing. */
  function requestClose(ids: string[]) {
    const threads = store.sessions.filter((s) => ids.includes(s.id));
    const midTurn = threads.filter((s) => messageStore.getIsRunning(s.id)).length;
    const withAgent = threads.filter((s) => backgroundAgentRunning(s));
    const agentOnly = withAgent.filter((s) => !messageStore.getIsRunning(s.id)).length;
    if (midTurn + agentOnly > 0) confirmClose = { ids, midTurn, agentOnly, agents: withAgent.length > 0 };
    else for (const id of ids) void stopSession(id);
  }

  /** The close confirmation's words: why the threads are still working, and
   *  what closing does to that work. A remote agent may carry on in the
   *  cloud, so it says the work won't be done, not that it stops. */
  function closeWarning({ midTurn, agentOnly, agents }: CloseAsk, single: boolean): { why: string; then: string } {
    if (single) {
      return {
        why: midTurn ? (agents ? 'is in the middle of a turn, with a background agent still running' : 'is in the middle of a turn') : 'has a background agent still running',
        then: agents ? 'Closing it shuts down its agent and terminal before that work is done.' : 'Closing it stops the turn and shuts down its terminal.',
      };
    }
    const why = [
      midTurn ? `${midTurn} of them ${midTurn === 1 ? 'is' : 'are'} in the middle of a turn` : '',
      agentOnly ? `${agentOnly}${midTurn ? '' : ' of them'} ${agentOnly === 1 ? 'has' : 'have'} a background agent still running` : '',
    ].filter(Boolean).join(', and ');
    return {
      why,
      then: agents ? 'Closing shuts down their agents and terminals before that work is done.' : `Closing stops ${midTurn === 1 ? 'that turn' : 'those turns'} and shuts down their terminals.`,
    };
  }

  function closeConfirmed() {
    const ids = confirmClose?.ids ?? [];
    confirmClose = null;
    for (const id of ids) void stopSession(id);
  }

  /** Open a draft conversation in `repo` (default: the open conversation's
   *  project). Nothing is created until its first message is sent. */
  function openNewAgent(repo = '') {
    draftStore.open(repo);
  }

  /** The draft row, always first under Conversations (and on the rail): back
   *  to the draft being written, or a new one. */
  function openDraftRow() {
    if (draftStore.draft) draftStore.show();
    else openNewAgent();
  }

  /** The draft row's tooltip, before there is a draft. */
  let newConversationHint = $derived(store.canCreate ? 'New thread (Ctrl+N)' : 'Add a project to start a thread');

  /** Rows start with a status column: a 20px character or an 8px dot. `lead`
   *  holds the New thread and draft rows' marks in that column (over the
   *  character's body, its left 12px, or centred on the dot); `indent` puts
   *  line 2 past it and the gap, under the branch icon. */
  let markColumn = $derived(settingsStore.current.groveCharacters
    ? { lead: 'w-5', indent: 'pl-7' }
    : { lead: 'w-2 justify-center', indent: 'pl-4' });

  /** A thread row's branch icon is the status bar's (prStore.branchShip),
   *  so a thread shows the same icon in both. PR and sync data are only
   *  polled for open tabs; anything else would be stale, so those rows get
   *  null and a plain branch. */
  function rowShip(session: (typeof store.sessions)[number]): BranchShip | null {
    if (session.noGit || !store.isOpenTab(session)) return null;
    return prStore.branchShip(session.id);
  }
  const PLAIN_BRANCH: ShipStage = { icon: 'branch', state: 'todo' };

  /** What deleting the conversation in the confirm dialog would lose: files
   *  with uncommitted changes in its worktree, and commits on its branch
   *  that its base branch doesn't have. Null while unknown. */
  let destroyUncommitted = $state<number | null>(null);
  let destroyUnmerged = $state<{ count: number; base: string } | null>(null);
  /** Delete waits for both checks, so a quick click can't skip a warning. */
  let destroyChecking = $state(false);
  /** Checks that failed or ran out of time. Each says so, and Delete then
   *  waits for "Delete anyway" rather than staying disabled: a thread whose
   *  worktree is broken or gone fails them, and still has to be deletable. */
  let destroyCheckFailed = $state({ uncommitted: false, unmerged: false, linked: false });
  /** The thread's linked projects, as their worktrees go with it: each
   *  one's uncommitted files and commits its default branch doesn't have.
   *  Null while unknown, or for a thread with none. */
  let destroyLinked = $state<LinkedProjectStatus[] | null>(null);
  /** The base branch the project doesn't have, when that is why the commits
   *  check failed: the warning names it, so the setting can be fixed. */
  let destroyMissingBase = $state<string | null>(null);
  let destroyAnyway = $state(false);
  /** The commits check only matters when the branch is deleted too. */
  let destroyNeedsAnyway = $derived(destroyCheckFailed.uncommitted || destroyCheckFailed.linked || (deleteBranchOnDestroy && destroyCheckFailed.unmerged));
  /** Main kills each git command a delete or remove-project check runs after
   *  this (local git has no timeout of its own), and the check fails. */
  const DELETE_CHECK_TIMEOUT_MS = 15_000;
  /** The dialog stops waiting after this even with no answer, rather than
   *  stay on "Checking…": a check stuck behind other git in the host's
   *  queue, which main's timeout doesn't cover. Long, so a check that is
   *  only queued isn't reported as failed. */
  const DELETE_CHECK_GIVE_UP_MS = 120_000;
  /** Bumped per request so a slow check from an earlier open is dropped. */
  let destroyGeneration = 0;

  function requestDestroy(id: string) {
    const generation = ++destroyGeneration;
    confirmDestroyId = id;
    deleteBranchOnDestroy = false;
    destroyUncommitted = null;
    destroyUnmerged = null;
    destroyCheckFailed = { uncommitted: false, unmerged: false, linked: false };
    destroyLinked = null;
    destroyMissingBase = null;
    destroyAnyway = false;
    destroyChecking = false;
    const session = store.sessions.find((s) => s.id === id);
    if (!session || session.direct) return;
    destroyChecking = true;
    const current = () => generation === destroyGeneration && confirmDestroyId === id;
    const failed = (check: keyof typeof destroyCheckFailed) => () => {
      if (current()) destroyCheckFailed = { ...destroyCheckFailed, [check]: true };
    };
    const timeout = { timeout: DELETE_CHECK_TIMEOUT_MS };
    const uncommitted = withTimeout(window.groveBench.getGitStatus(id, timeout), DELETE_CHECK_GIVE_UP_MS)
      .then((status) => {
        // A status git couldn't read may hide changes.
        if (status.error) throw new Error(status.error);
        if (current()) destroyUncommitted = unsavedFileCount(status.entries, agentsStore.generatedFiles());
      })
      .catch(failed('uncommitted'));
    const unmerged = withTimeout(resolveBaseBranch(session.repoPath).then(async (base) => ({ base, result: await window.groveBench.getBranchCommits(id, base, timeout) })), DELETE_CHECK_GIVE_UP_MS)
      .then(({ base, result }) => {
        if (!current()) return;
        if (result.error) {
          if (result.missingBase) destroyMissingBase = base;
          throw new Error(result.error);
        }
        destroyUnmerged = { count: result.commits.length, base };
      })
      .catch(failed('unmerged'));
    // Linked projects' worktrees go too. A link that can't be read counts
    // as a failed check: it may hold changes.
    const linked = session.linkedRepos?.length
      ? withTimeout(window.groveBench.getLinkedStatus(id), DELETE_CHECK_GIVE_UP_MS)
        .then((statuses) => {
          if (statuses.some((l) => !l.missing && l.uncommitted === null)) throw new Error("couldn't read a linked worktree");
          if (current()) destroyLinked = statuses;
        })
        .catch(failed('linked'))
      : Promise.resolve();
    void Promise.all([uncommitted, unmerged, linked]).then(() => { if (current()) destroyChecking = false; });
  }

  /** Whether a thread's linked projects' worktrees, which go with it, have
   *  uncommitted changes. Null when one couldn't be read (it may); false for
   *  a thread with none. */
  async function linkedDirty(s: { id: string; linkedRepos?: string[] }): Promise<boolean | null> {
    if (!s.linkedRepos?.length) return false;
    try {
      const statuses = await withTimeout(window.groveBench.getLinkedStatus(s.id), DELETE_CHECK_GIVE_UP_MS);
      if (statuses.some((l) => !l.missing && l.uncommitted === null)) return null;
      return statuses.some((l) => (l.uncommitted ?? 0) > 0);
    } catch {
      return null;
    }
  }

  /** `promise`, or a rejection once `ms` pass without it settling. */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`No answer within ${ms / 1000} s`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /** Full teardown of one session: main-process destroy plus all per-session
   *  renderer state (see forgetConversation). Shared
   *  by the per-row destroy flow and the bulk clean-up dialog. A failure is
   *  shown as the app's error unless `onError` takes it instead. */
  async function destroySessionById(id: string, deleteBranch: boolean, onError: (message: string) => void = (m) => store.setError(m)): Promise<boolean> {
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
    } catch (e) {
      onError(errorMessage(e));
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
  /** How many threads, and branches, the checks couldn't answer for (failed
   *  or ran out of time). As in the delete dialog, Remove then waits for
   *  "Remove anyway", and the commits check only counts when the branches go. */
  let removeRepoCheckFailed = $state({ uncommitted: 0, unmerged: 0 });
  /** The base branch the project doesn't have, when that is why the
   *  commits checks failed. */
  let removeRepoMissingBase = $state<string | null>(null);
  let removeRepoAnyway = $state(false);
  let removeRepoNeedsAnyway = $derived(removeRepoCheckFailed.uncommitted > 0 || (removeRepoDeleteBranches && removeRepoCheckFailed.unmerged > 0));
  let removingRepo = $state(false);
  /** Set when conversations appeared while the dialog was open, so it checked again. */
  let removeRepoRechecked = $state(false);
  /** Bumped per request so a slow check from an earlier open is dropped. */
  let removeRepoGeneration = 0;
  /** git calls the checks run at once, so a big project doesn't start one
   *  process per conversation in a burst (as the clean-up limits gh). */
  const REMOVE_CHECK_CONCURRENCY = 3;

  /** Threads in other projects that work in `repo` through a linked
   *  worktree: the project can't be removed while they are there. */
  function linkingThreads(repo: string) {
    return store.sessions.filter((s) => s.repoPath !== repo && s.linkedRepos?.includes(repo));
  }

  function requestRemoveRepo(repo: string) {
    const generation = ++removeRepoGeneration;
    const sessions = store.sessionsForRepo(repo);
    confirmRemoveRepo = repo;
    removeRepoIds = sessions.map((s) => s.id);
    removeRepoDeleteBranches = false;
    removeRepoRechecked = false;
    removeRepoDirty = null;
    removeRepoUnmerged = null;
    removeRepoCheckFailed = { uncommitted: 0, unmerged: 0 };
    removeRepoMissingBase = null;
    removeRepoAnyway = false;
    removingRepo = false;
    // Direct conversations work in the project folder itself: removing one
    // deletes no files and keeps the branch, so there is nothing to check.
    const worktreeSessions = sessions.filter((s) => !s.direct);
    removeRepoChecking = worktreeSessions.length > 0;
    if (!removeRepoChecking) return;
    const current = () => generation === removeRepoGeneration && confirmRemoveRepo === repo;
    // Uncommitted changes first, then unmerged commits (one per branch:
    // conversations sharing a branch share its commits). Null: a check that
    // failed or didn't answer in time, which is counted and said. Each call
    // ends in .catch, so nothing it throws leaves the dialog on Checking….
    const timeout = { timeout: DELETE_CHECK_TIMEOUT_MS };
    void (async () => {
      const dirty = await mapLimit(worktreeSessions, REMOVE_CHECK_CONCURRENCY, (s) =>
        withTimeout(window.groveBench.getGitStatus(s.id, timeout), DELETE_CHECK_GIVE_UP_MS)
          // A status git couldn't read may hide changes, and so may a linked
          // worktree, which goes with the thread.
          .then(async (status) => {
            if (status.error) return null;
            if (unsavedFileCount(status.entries, agentsStore.generatedFiles()) > 0) return true;
            return linkedDirty(s);
          })
          .catch(() => null),
      );
      if (!current()) return;
      removeRepoDirty = dirty.filter(Boolean).length;
      removeRepoCheckFailed = { ...removeRepoCheckFailed, uncommitted: dirty.filter((d) => d === null).length };
      const base = await withTimeout(resolveBaseBranch(repo), DELETE_CHECK_GIVE_UP_MS).catch(() => null);
      const oneSessionPerBranch = [...new Map(worktreeSessions.map((s) => [s.branch, s])).values()];
      const unknown = { count: null, missingBase: false };
      const answers = await mapLimit(oneSessionPerBranch, REMOVE_CHECK_CONCURRENCY, (s) =>
        base === null
          ? Promise.resolve(unknown)
          : withTimeout(window.groveBench.getBranchCommits(s.id, base, timeout), DELETE_CHECK_GIVE_UP_MS)
            .then((r) => (r.error ? { count: null, missingBase: !!r.missingBase } : { count: r.commits.length, missingBase: false }))
            .catch(() => unknown),
      );
      if (!current()) return;
      if (base !== null) removeRepoUnmerged = { count: answers.filter((a) => a.count !== null && a.count > 0).length, base };
      removeRepoMissingBase = base !== null && answers.some((a) => a.missingBase) ? base : null;
      removeRepoCheckFailed = { ...removeRepoCheckFailed, unmerged: answers.filter((a) => a.count === null).length };
      removeRepoChecking = false;
    })();
  }

  /** Delete the project's checked conversations, then remove the project. */
  async function confirmRemoveProject() {
    const repo = confirmRemoveRepo;
    if (!repo) return;
    // Its threads would be deleted, then main would refuse to forget it.
    if (linkingThreads(repo).length > 0) return;
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
    } catch (e) {
      store.setError(errorMessage(e));
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
    } catch (e) {
      if (renamingSessionId === id) renameError = errorMessage(e);
    }
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void confirmRename(); }
  }

  // ── Attention triage: filter chips, per-repo counts ──

  let triageFilter = $state<TriageFilter>('all');

  /** The chips shown. There is no "All" chip: clicking the active chip
   *  again goes back to all, which keeps the row short. */
  const CHIP_FILTERS = TRIAGE_FILTERS.filter((f): f is Exclude<TriageFilter, 'all'> => f !== 'all');
  /** To do waits for the saved flags, as its menu items do. */
  let chipFilters = $derived(todoStore.ready ? CHIP_FILTERS : CHIP_FILTERS.filter((f) => f !== 'todo'));

  function toggleFilter(f: TriageFilter) {
    triageFilter = triageFilter === f ? 'all' : f;
  }

  /** To do has its ring instead of a dot. */
  const TRIAGE_DOT: Record<Exclude<TriageFilter, 'all' | 'todo'>, string> = {
    'needs-you': 'bg-status-attention',
    working: 'bg-status-working',
    unread: 'bg-status-unread',
    // A ready thread's grey (AGENT_SPRITES.ready).
    idle: 'bg-foreground/60',
  };

  /** Branch groups folded in the Projects tree, by project and branch. Kept
   *  for this run only: groups come and go with their conversations. */
  let collapsedBranches = $state<Record<string, boolean>>({});
  const branchKey = (repo: string, branch: string) => `${repo}\n${branch}`;

  function toggleBranchCollapsed(repo: string, branch: string) {
    const key = branchKey(repo, branch);
    collapsedBranches = { ...collapsedBranches, [key]: !collapsedBranches[key] };
  }

  /** Which chip a conversation counts under: the one its status colour
   *  matches, and To do as well when it is flagged. */
  function triageOf(session: { id: string; status: SessionStatus }): TriageEntry {
    return {
      state: triageForSprite(sessionSpriteState(session, destroying.has(session.id))),
      todo: todoStore.has(session.id),
    };
  }

  /** Counts for the filter chips, over active and stopped sessions alike. */
  let counts = $derived(triageCounts(store.sessions.map(triageOf)));

  /** Threads that match the active chip right now. Empty for all. */
  let matchingIds = $derived(
    triageFilter === 'all'
      ? new Set<string>()
      : new Set(store.sessions.filter((s) => matchesTriageFilter(triageFilter, triageOf(s))).map((s) => s.id)),
  );

  /** The focused thread, kept on the list under the chip it was listed under
   *  after it stops matching (opened and read, prompt answered, turn ended),
   *  so the row doesn't vanish on click. It goes once another thread is
   *  focused or the chip changes, not when the thread is deselected. */
  let keptRowId = $state<string | null>(null);
  // As of the last check. Focusing a thread clears its unread flag in the
  // same step, so it has to be caught from what matched just before.
  let matchedBefore = new Set<string>();
  let filterBefore: TriageFilter = 'all';

  // Pre, so the list never renders a frame without the row.
  $effect.pre(() => {
    const id = store.activeSessionId;
    const filter = triageFilter;
    const matching = matchingIds;
    untrack(() => {
      const target = id ?? keptRowId;
      const keep = !!target && filter !== 'all' && (
        matching.has(target)
        || (filter === filterBefore && (matchedBefore.has(target) || keptRowId === target))
      );
      keptRowId = keep ? target : null;
      matchedBefore = matching;
      filterBefore = filter;
    });
  });

  function rowVisible(session: { id: string; status: string }): boolean {
    return triageFilter === 'all' || matchingIds.has(session.id) || session.id === keptRowId;
  }

  /** Open tabs (live sessions, plus restored tabs waiting to reconnect) that pass the filter, ordered by the
   *  active sort. This is the always-visible "working set"; the landing's picker shows the same list.
   *  Under To do it is every flagged thread, closed ones too: otherwise those would only be in the
   *  Projects tree, where projects start folded. */
  let activeSessions = $derived(
    triageFilter === 'todo'
      ? sortSessions(store.sessions.filter(rowVisible), store.sessionSort)
      : store.openConversations.filter(rowVisible),
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
  /** Open follow-ups in the projects still here: a removed project's can't be started. */
  let openFollowUps = $derived(followUpsStore.openCountIn(store.repos));
  let followUpsLabel = $derived(openFollowUps === 0 ? 'Follow-ups' : `Follow-ups: ${openFollowUps} open`);

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
  <!-- Described once, for every row's ✕. -->
  <span id="close-conversation-hint" hidden>{CLOSE_HINT}</span>
  <!-- Bookmarks, follow-ups, memory, skills, clean-up and settings: in the footer, or down the rail -->
  {#snippet footerTools()}
    <Button
      onclick={() => bookmarkStore.toggleDrawer()}
      variant="quiet"
      size="sm"
      class="px-2 shrink-0"
      title="Bookmarks (Ctrl+B)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
    </Button>
    <!-- Work agents left for later threads, with how many are open. -->
    <Button
      onclick={() => followUpsStore.toggleDrawer()}
      variant="quiet"
      size="sm"
      class="relative px-2 shrink-0"
      title={followUpsLabel}
      aria-label={followUpsLabel}
    >
      <ListTodoIcon class="size-4" />
      {#if openFollowUps > 0}
        <Badge tone="primary" variant="solid" count class="absolute -top-0.5 -right-0.5 pointer-events-none" aria-hidden="true">{openFollowUps > 99 ? '99+' : openFollowUps}</Badge>
      {/if}
    </Button>
    <Button
      onclick={() => memoryStore.panelOpen = true}
      variant="quiet"
      size="sm"
      class="px-2 shrink-0"
      title="Project Memory"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-1.5 0-3 .8-4 2s-1.5 3-2.5 3.5C4 8.5 3 10 3 12c0 1.5.5 3 1.5 4s1 2.5.5 3.5c.5 1.5 2 2.5 3.5 2.5H12"/><path d="M12 2c1.5 0 3 .8 4 2s1.5 2.5 2.5 3c1.5 1 2 2.5 2 4"/><path d="M12 2v20"/><path d="M12 8h5"/><path d="M12 14h4"/><circle cx="17.5" cy="8" r="1.2" fill="currentColor"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor"/></svg>
    </Button>
    <!-- Always here, so the drawer opens even when a narrow status bar
         has dropped its Skills count. -->
    <Button
      onclick={() => (store.activeSessionId ? skillsPanelStore.showThread() : skillsPanelStore.showScheduled())}
      variant="quiet"
      size="sm"
      class="px-2 shrink-0"
      title="Skills: run, schedule and share them"
      aria-label="Skills"
    >
      <WandSparklesIcon class="size-4" />
    </Button>
    <!-- While a clean-up runs (its dialog may be closed), the broom turns
         into a turning square; clicking shows the run's progress. -->
    <Button
      onclick={openCleanup}
      variant="quiet"
      size="sm"
      class="px-2 shrink-0"
      title={cleaningUp ? `Removing old threads: ${cleanupStore.settled} of ${cleanupStore.total} done` : 'Clean up old threads'}
      aria-busy={cleaningUp}
    >
      {#if cleaningUp}
        <span class="flex size-4 items-center justify-center"><Pulse size="sm" motion="spin" /></span>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 11 9-9"/><path d="M14.6 12.6c.8.8.9 2.1.2 3L10 22l-8-8 6.4-4.8c.9-.7 2.2-.6 3 .2Z"/><path d="m6.8 10.4 6.8 6.8"/><path d="m5 17 1.4-1.4"/></svg>
      {/if}
    </Button>
    <Button
      onclick={() => settingsStore.panelOpen = true}
      variant="quiet"
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
    <!-- Shells and monitors its agent left running: their words, worked out once for the badge and the tooltip. -->
    {@const shells = describeShells(backgroundShells(session))}
    <!-- Changed in the worktree: the Changes tab may be listing the whole branch. -->
    {@const gitState = gitStatusStore.getStatus(session.id)}
    {@const changedCount = isStopped ? 0 : (gitState.uncommitted ?? gitState.entries.length)}
    {@const linkedNames = (session.linkedRepos ?? []).map((r) => store.repoDisplayName(r)).join(', ')}
    {@const label = labelOverride ?? sessionRowLabel(session)}
    {@const group = showGroup ? groupStore.groupOf(session.id) : null}
    {@const ship = rowShip(session)}
    {@const stage = ship?.track.stage ?? PLAIN_BRANCH}
    {@const branchIconLabel = (session.noGit ? 'In the project folder (no git)' : session.direct ? 'Direct (no worktree)' : 'Worktree') + (ship?.summary ? `: ${ship.summary}` : '')}
    <!-- The quick action is a sibling of the row button, not inside it: a button can't hold another. -->
    <div
      class="relative group/session"
      oncontextmenu={(e) => { if (isDestroying) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
      role="presentation"
    >
      <button
        onclick={(e) => { if (!isDestroying) toggleSession(session.id, e.detail); }}
        disabled={isDestroying}
        aria-current={store.activeSessionId === session.id ? 'true' : undefined}
        title={rowTitle(session.id, label, subtitle, shells?.tooltip)}
        class="w-full flex flex-col pl-4 pr-2 py-1.5 text-left transition-colors
          {isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}
          {restFade}"
      >
        <!-- Line 1 is the conversation's name, so it gets the width; the project goes on line 2. -->
        <div class="w-full flex items-center gap-2 min-w-0">
          {@render statusMark(session, isDestroying, repoColor)}
          <!-- The status bar's icon (ShipIcon): its shape how far the branch
               has got, its colour the step that matters most, dimmed and
               pulsing as there. Grey like the lozenge's text when nothing
               stands out. Worktree or direct is in the tooltip. No git: no
               branch, so a folder. size-4 beside text-sm (docs/ui-kit.md). -->
          {#if session.noGit}
            <span class="flex shrink-0 text-muted-foreground" role="img" aria-label={branchIconLabel} title={branchIconLabel} data-ship-icon="folder">
              <FolderIcon class="size-4" aria-hidden="true" />
            </span>
          {:else}
            <ShipIcon
              {stage}
              stale={ship?.stale}
              alert={ship?.alert}
              iconClass="size-4"
              class="text-muted-foreground"
              role="img"
              aria-label={branchIconLabel}
              title={branchIconLabel}
              data-ship-icon={stage.icon}
              data-ship-state={stage.state}
            />
          {/if}
          <span class="text-sm truncate min-w-0 flex-1">{label}</span>
          {#if todoStore.has(session.id)}
            <span class="shrink-0 flex text-foreground/80" role="img" aria-label="To do" title="To do (right-click to clear)" data-row-todo><TodoMark /></span>
          {/if}
          {#if ts}
            <!-- Invisible, not hidden, while the quick action sits over it, so the name doesn't reflow. -->
            <span
              class="shrink-0 text-micro text-muted-foreground {isDestroying ? '' : 'group-hover/session:invisible group-has-[:focus-visible]/session:invisible'}"
              title="{session.lastActiveAt ? 'Last active' : 'Created'} {new Date(ts).toLocaleString()}"
            >{formatAge(ts)}</span>
          {/if}
        </div>
        {#if group || showProject || subtitle || changedCount > 0 || shells || linkedNames}
          <div class="w-full flex items-center gap-1.5 {markColumn.indent} mt-0.5 min-w-0">
            <span class="text-caption truncate min-w-0">
              {#if group}<span class="text-foreground/60" title="Group: {group.name}" data-row-group>{group.name}</span>{#if showProject || subtitle}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}
              {#if showProject}
                <!-- A grove character carries the project colour on its laptop, so the square is only needed with the plain dot. -->
                {#if repoColor && !settingsStore.current.groveCharacters}<span class="inline-block w-1.5 h-1.5 align-middle mr-1" style="background-color: {repoColor}"></span>{/if}<span class="text-muted-foreground">{store.repoDisplayName(session.repoPath)}</span>{#if subtitle}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}{#if subtitle}<span class={SUBTITLE_TONE_CLASS[subtitle.tone]}>{subtitle.text}</span>{/if}
            </span>
            {#if shells || changedCount > 0 || linkedNames}
              <span class="ml-auto shrink-0 flex items-center gap-1.5" data-row-badges>
                {#if linkedNames}
                  <!-- Other projects the thread works in, through their own worktrees. -->
                  <Badge
                    tone="muted"
                    count
                    role="img"
                    aria-label="Also works in {linkedNames}"
                    title="Also works in {linkedNames}, through its own worktree"
                    data-row-linked
                  ><Link2Icon aria-hidden="true" />{session.linkedRepos?.length}</Badge>
                {/if}
                {#if shells}
                  <!-- Commands the agent left running (a dev server, a
                       watcher, a monitor). Blue, as something still running
                       is (BRAND.md), but a still badge, not the dot: the
                       thread itself isn't working. -->
                  <Badge
                    tone="working"
                    count
                    role="img"
                    aria-label={shells.summary}
                    title={shells.tooltip}
                    data-row-shells
                  ><TerminalIcon aria-hidden="true" />{shells.count}</Badge>
                {/if}
                {#if changedCount > 0}
                  <Badge
                    tone="muted"
                    count
                    title="{changedCount} changed file{changedCount === 1 ? '' : 's'} in the worktree"
                  >±{changedCount}</Badge>
                {/if}
              </span>
            {/if}
          </div>
        {/if}
      </button>
      {#if !isDestroying}
        {#if !store.isOpenTab(session)}
          <!-- Closed session: delete (removes the worktree, after asking). -->
          <Button
            variant="quiet-destructive"
            size="icon-2xs"
            title="Delete thread"
            aria-label="Delete thread {label}"
            onclick={() => requestDestroy(session.id)}
            class="absolute top-1.5 right-2 opacity-0 group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100"
          >
            <!-- A bin, not an ✕: ✕ reads as "close", and this deletes. -->
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </Button>
        {:else}
          <!-- Open session (live, or restored and waiting to reconnect, like the
               context menu): close it (stops the agent but keeps it resumable). -->
          <Button
            variant="quiet"
            size="icon-2xs"
            title={`Close thread\n${CLOSE_HINT}`}
            aria-label="Close thread {label}"
            aria-describedby="close-conversation-hint"
            onclick={() => requestClose([session.id])}
            class="absolute top-1.5 right-2 opacity-0 group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </Button>
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
      class={Segmented.segmentedItem({ selected: active })}
      title="Sort by {label.toLowerCase()}{active ? (sort.dir === 'asc' ? ' (ascending)' : ' (descending)') : ''}"
    >
      {label}
      {#if active}
        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" style={sort.dir === 'asc' ? 'transform: rotate(180deg)' : ''}><path d="m6 9 6 6 6-6"/></svg>
      {/if}
    </button>
  {/snippet}

  <!-- Folded sections at the end of the list sit at the bottom of the sidebar:
       the free space goes just above the first of them. Its flex-grow eases
       in and out with the section's slide, so a heading glides to and from
       the bottom rather than jumping. -->
  {#snippet dockSpacer(section: string, active: boolean)}
    <div
      class="shrink-0 {active ? 'grow' : 'grow-0'} transition-[flex-grow] duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none"
      data-dock-spacer={section}
      data-active={active}
    ></div>
  {/snippet}

  {#if collapsed}
    <!-- Rail: expand, search, the open conversations, the footer's buttons -->
    <div class="flex flex-col items-center gap-1 pt-3 pb-2 shrink-0 border-b border-sidebar-border" data-rail>
      <PanelToggle panel="sidebar" label="sidebar" />
      <Button
        variant="quiet"
        size="icon-xs"
        onclick={() => store.finderOpen = true}
        title="Search threads (Ctrl+R)"
        aria-label="Search threads"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto overflow-x-hidden py-2">
      <button
        type="button"
        onclick={openDraftRow}
        disabled={!draftStore.draft && !store.canCreate}
        class="w-full flex justify-center py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          {draftStore.visible && !boardStore.open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50 disabled:hover:bg-transparent'}"
        title={draftStore.draft ? 'New thread, not started yet' : newConversationHint}
        aria-label={draftStore.draft ? 'New thread, not started yet' : 'New thread'}
        data-rail-draft
      >
        {#if draftStore.draft}
          <span class="w-2 h-2 border border-dashed border-muted-foreground"></span>
        {:else}
          <svg class="text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        {/if}
      </button>
      {#if settingsStore.current.boardView}
        <button
          type="button"
          onclick={() => { if (boardStore.open) boardStore.showList(); else boardStore.show(); }}
          aria-pressed={boardStore.open}
          class="w-full flex justify-center py-2 transition-colors {boardStore.open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
          title={boardStore.open ? 'Back to the thread list' : 'Board: your open threads as cards by stage (alpha)'}
          aria-label="Board"
          data-rail-board
        >
          <SquareKanbanIcon class="size-3 text-muted-foreground" aria-hidden="true" />
        </button>
      {/if}
      <!-- Every open conversation: the triage filter isn't on the rail to explain a shorter list. -->
      {#each store.openConversations as session (session.id)}
        {@const isDestroying = destroying.has(session.id)}
        {@const isSleeping = sessionSpriteState(session, isDestroying) === 'sleeping'}
        {@const subtitle = rowSubtitle(session)}
        {@const name = `${store.repoDisplayName(session.repoPath)} / ${sessionRowLabel(session)}`}
        {@const shells = describeShells(backgroundShells(session))}
        <button
          onclick={(e) => { if (!isDestroying) toggleSession(session.id, e.detail); }}
          oncontextmenu={(e) => { if (isDestroying) { e.preventDefault(); return; } openContextMenu(e, session.id); }}
          disabled={isDestroying}
          aria-current={store.activeSessionId === session.id ? 'true' : undefined}
          title={rowTitle(session.id, name, subtitle, shells?.tooltip)}
          aria-label={shells ? `${name}, ${shells.summary}` : name}
          data-rail-session={session.id}
          class="relative w-full flex justify-center py-2 transition-colors
            {isDestroying ? 'opacity-50 cursor-not-allowed' : store.activeSessionId === session.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}
            {isSleeping ? 'opacity-70' : ''}"
        >
          {@render statusMark(session, isDestroying, getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors))}
          {#if shells}
            <!-- The row's badge doesn't fit the rail: its icon, in the corner. -->
            <span class="absolute right-1.5 bottom-0.5 flex text-status-working" aria-hidden="true" data-rail-shells>
              <TerminalIcon class="size-2.5" />
            </span>
          {/if}
        </button>
      {/each}
    </div>
    <div class="py-3 border-t border-sidebar-border flex flex-col items-center gap-1 shrink-0">
      {@render footerTools()}
    </div>
  {/if}

  <!-- Search: opens the session finder (titles + full conversation content) -->
  <div class="px-3 pt-3 {collapsed ? 'hidden' : 'flex'} items-center gap-1">
    <button
      onclick={() => store.finderOpen = true}
      class="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 bg-sidebar-accent/40 border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
      title="Search threads (Ctrl+R)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <span class="text-xs truncate">Search threads…</span>
      <Kbd keys="Ctrl+R" class="ml-auto shrink-0" />
    </button>
    <PanelToggle panel="sidebar" label="sidebar" class="-mr-1" />
  </div>

  <!-- List / Board (alpha, Settings > General > Views): the board takes the
       main pane, as a thread does. Opening a thread from the list goes back. -->
  {#if settingsStore.current.boardView}
    <div class="px-3 pt-2 {collapsed ? 'hidden' : 'flex'}">
      <Segmented.Root
        value={boardStore.open ? 'board' : 'list'}
        onValueChange={(v) => { if (v === 'board') boardStore.show(); else if (v === 'list') boardStore.showList(); }}
        aria-label="Show threads as"
        class="w-full"
        data-board-switch
      >
        <Segmented.Item value="list" class="flex-1 justify-center py-1"><ListIcon />List</Segmented.Item>
        <Segmented.Item value="board" class="flex-1 justify-center py-1" title="Board: your open threads as cards by stage (alpha)"><SquareKanbanIcon />Board</Segmented.Item>
      </Segmented.Root>
    </div>
  {/if}

  <!-- No bottom padding: a folded section's heading sits right on the footer. -->
  <div class="flex-1 overflow-auto px-3 pt-3 flex-col {collapsed ? 'hidden' : 'flex'}">
    <div class="shrink-0 pb-3">
      <!-- Triage filter: what needs me, what is working, what finished while I was away,
           what is open and quiet, and what I flagged to come back to. Click a chip to
           show only those; click it again to show all. Wraps when the sidebar is too
           narrow for them all. Hidden, with the sort, until there is a conversation
           to filter. -->
      {#if store.sessions.length > 0}
      <!-- 9px, plus a chip's 1px border and 6px padding, puts the dots in line
           with the rows' status column, like the Threads heading below. -->
      <div class="flex flex-wrap items-center gap-1 mb-2 pl-2.25 pr-1" role="group" aria-label="Filter threads">
        {#each chipFilters as f (f)}
          {@const n = counts[f]}
          {@const active = triageFilter === f}
          <button
            type="button"
            onclick={() => toggleFilter(f)}
            aria-pressed={active}
            aria-label="{TRIAGE_FILTER_LABELS[f]} {n}"
            class="flex items-center gap-1 px-1.5 py-0.5 text-micro border transition-colors
              {active ? 'border-border bg-sidebar-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}
              {n === 0 ? 'opacity-50' : ''}"
            title="{TRIAGE_FILTER_LABELS[f]}: {n}{active ? '. Click again to show all' : ''}"
          >
            {#if f === 'todo'}
              <TodoMark class="text-foreground/80" />
            {:else}
              <span class="w-1.5 h-1.5 shrink-0 {TRIAGE_DOT[f]}"></span>
            {/if}
            <!-- Narrow sidebar: dot and count only, the label is in the tooltip. -->
            {#if !compact}{TRIAGE_FILTER_LABELS[f]}{/if}
            <span class="text-muted-foreground">{n}</span>
          </button>
        {/each}
      </div>
      {/if}

      <!-- CONVERSATIONS: the live working set, always visible at the top. The sort
           applies to the Projects tree too. -->
      <!-- Inset like the rows: the label over their status column, the sort
           over their times. -->
      <div class="flex items-center justify-between mb-1 pl-4 pr-2">
        <SectionLabel as="span">Threads</SectionLabel>
        {#if store.sessions.length > 0}
          <div class={Segmented.segmentedRoot} role="group" aria-label="Sort threads">
            {@render sortButton('name', 'Name')}
            {@render sortButton('age', 'Age')}
          </div>
        {/if}
      </div>

      {#if draftStore.draft}
        {@const draft = draftStore.draft}
        {@const draftGroup = draftStore.groupName}
        <!-- The draft conversation: not started, so nothing exists yet. -->
        <button
          type="button"
          onclick={openDraftRow}
          class="w-full flex flex-col pl-4 pr-2 py-1.5 text-left transition-colors {draftStore.visible && !boardStore.open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}"
          title="New thread, not started yet"
          data-draft-row
        >
          <span class="w-full flex items-center gap-2 min-w-0">
            <span class="{markColumn.lead} shrink-0 flex"><span class="w-2 h-2 shrink-0 border border-dashed border-muted-foreground"></span></span>
            <span class="text-sm truncate min-w-0 flex-1 italic text-muted-foreground">{draftTitle(draft.text)}</span>
            <span class="text-micro text-muted-foreground shrink-0">draft</span>
          </span>
          {#if store.repos.length > 1 || draftGroup}
            <span class="{markColumn.indent} mt-0.5 text-caption text-muted-foreground truncate">{#if draftGroup}<span class="text-foreground/60">{draftGroup}</span>{#if store.repos.length > 1}<span class="text-muted-foreground/40">{' · '}</span>{/if}{/if}{#if store.repos.length > 1}{store.repoDisplayName(draft.repoPath)}{/if}</span>
          {/if}
        </button>
      {:else}
        <!-- Always first: starts a draft in the open conversation's project,
             which then takes this row's place. -->
        <button
          type="button"
          onclick={openDraftRow}
          disabled={!store.canCreate}
          class="w-full flex items-center gap-2 pl-4 pr-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/50
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={newConversationHint}
          aria-label="New thread"
          data-draft-row
        >
          <span class="{markColumn.lead} shrink-0 flex"><svg class="shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg></span>
          <span class="text-sm truncate min-w-0 flex-1 italic text-muted-foreground">New thread</span>
          <Kbd keys="Ctrl+N" class="shrink-0" />
        </button>
      {/if}
      {#each activeSessions as session (session.id)}
        <!-- The project name only helps when there is more than one. -->
        {@render sessionRow(session, store.repos.length > 1, null, true)}
      {/each}
      <!-- With no filter the draft row is enough; a filter says why the list is short. -->
      {#if activeSessions.length === 0 && triageFilter === 'todo' && counts.todo === 0}
        <p class="text-xs text-muted-foreground pl-4 py-1">No threads to do. Right-click one and choose Mark as To Do to come back to it later.</p>
      {:else if activeSessions.length === 0 && triageFilter !== 'all'}
        <p class="text-xs text-muted-foreground pl-4 py-1">No threads match "{TRIAGE_FILTER_LABELS[triageFilter]}"</p>
      {/if}
    </div>

    <!-- GROUPS: conversations across projects that belong to one piece of work.
         Its spacer is there even when the section isn't: it is then right above
         Projects', so it docks Projects just the same. -->
    {@render dockSpacer('groups', groupsCollapsed && projectsCollapsed)}
    <SidebarGroups
      row={sessionRow}
      {rowVisible}
      countsFor={headerCounts}
      stopSessions={requestClose}
      filterLabel={triageFilter === 'all' ? null : TRIAGE_FILTER_LABELS[triageFilter]}
    />

    <!-- PROJECTS: every repo with its sessions (stopped ones actionable); hosts repo management -->
    {@render dockSpacer('projects', projectsCollapsed && !groupsCollapsed)}
    <SidebarSection panel="projectsSection" label="Projects" count={store.repos.length} {counts}>
      {#snippet actions()}
        {#if closedCount}
          <span class="text-micro text-muted-foreground shrink-0">{closedCount} closed</span>
        {/if}
        <Button
          variant="quiet"
          size="icon-2xs"
          onclick={addProject}
          title="Add a project"
          aria-label="Add a project"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        </Button>
      {/snippet}

      <div class="pt-1 pb-2">
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
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted-foreground transition-transform" style={repoCollapsed ? 'transform: rotate(-90deg)' : ''}><path d="m6 9 6 6 6-6"/></svg>
                {#if repoColor}
                  <span class="w-2 h-2 shrink-0" style="background-color: {repoColor}"></span>
                {/if}
                <span class="text-xs font-medium text-muted-foreground truncate" title={repo}>
                  {store.repoDisplayName(repo)}
                </span>
                {#if rowCount}
                  <span class="text-xs text-muted-foreground shrink-0">{rowCount}</span>
                {/if}
                <!-- Per-repo attention counts, same dots as the filter chips -->
                <AttentionCounts counts={repoCounts(repo)} />
              </button>
              <div class="flex items-center gap-0.5">
                <!-- A bin, like a conversation's delete: removing a project deletes its conversations too (it asks first).
                     Before the +: it only shows on hover, and on the outside it left a gap at the row's edge. -->
                <Button
                  variant="quiet-destructive"
                  size="icon-2xs"
                  onclick={() => requestRemoveRepo(repo)}
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  title="Remove project"
                  aria-label="Remove project {store.repoDisplayName(repo)}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                </Button>
                <!-- Shown when the project has scheduled skills, else on hover like the bin. -->
                <Button
                  variant="quiet"
                  size="icon-2xs"
                  onclick={() => skillsPanelStore.showScheduled(repo)}
                  class={schedulesStore.forRepo(repo).length ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}
                  title="Scheduled skills in {store.repoDisplayName(repo)}"
                  aria-label="Scheduled skills in {store.repoDisplayName(repo)}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </Button>
                <!-- Always shown: this is the main way to start a conversation in a project. -->
                <Button
                  variant="quiet"
                  size="icon-2xs"
                  onclick={() => openNewAgent(repo)}
                  title="New thread in {store.repoDisplayName(repo)}"
                  aria-label="New thread in {store.repoDisplayName(repo)}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                </Button>
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
                      class="w-full flex items-center gap-1.5 px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 transition-transform" style={branchCollapsed ? 'transform: rotate(-90deg)' : ''} aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                      <span class="truncate" title={branch}>{branch}</span>
                      <span>({sessions.length})</span>
                    </button>
                    {#if !branchCollapsed}
                      {#each sessions as session, i (session.id)}
                        {@render sessionRow(session, false, session.displayName || `thread ${i + 1}`, true)}
                      {/each}
                    {/if}
                  </div>
                {/if}
              {/each}

              {#if branchGroups.length === 0}
                <p class="text-xs text-muted-foreground pl-4 py-1">{triageFilter === 'all' ? 'No threads in this project' : `No threads match "${TRIAGE_FILTER_LABELS[triageFilter]}"`}</p>
              {/if}
            {/if}
          </div>
        {/each}

        {#if store.repos.length === 0}
          <p class="text-xs text-muted-foreground mt-2">Add a project to get started.</p>
        {/if}
      </div>
    </SidebarSection>
  </div>

  <!-- Bottom controls -->
  <div class="px-4 py-3 border-t border-sidebar-border {collapsed ? 'hidden' : 'flex'} justify-between">
    {@render footerTools()}
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
  <!-- Closing it while removing only hides it: the run carries on
       (cleanupStore), the sidebar's clean-up button shows it, and a toast
       says when it's done (CleanupToast). -->
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) showCleanup = false; }}>
    <Dialog.Content class="max-w-md">
      <Dialog.Header>
        <Dialog.Title>Clean Up Old Threads</Dialog.Title>
        <Dialog.Description>
          {#if cleanupStore.run}
            Removing the threads you chose. You can close this: removal carries on, the clean-up button in the sidebar shows it, and you'll be told when it's done.
          {:else}
            Remove closed threads you no longer need. Removing a thread kills its shell and deletes its worktree. Threads with uncommitted changes or marked To do are flagged and left unselected. Tick them only if you're sure. Each thread's pull request state is shown when the GitHub CLI is available; merged ones are the safest to remove. Branches are kept unless you choose otherwise; if you do, threads with commits that aren't on the base branch yet are flagged. Running threads are never listed.
          {/if}
        </Dialog.Description>
      </Dialog.Header>

      {#if cleanupStore.run}
        {@const run = cleanupStore.run}
        <div class="flex flex-col gap-2">
          <div class="text-xs text-muted-foreground" aria-live="polite">
            {cleanupStore.settled} of {cleanupStore.total} done
          </div>
          <div
            role="progressbar"
            aria-label="Clean-up progress"
            aria-valuemin={0}
            aria-valuemax={cleanupStore.total}
            aria-valuenow={cleanupStore.settled}
            class="h-1 bg-muted"
          >
            <div class="h-full bg-status-working transition-[width] duration-200" style="width: {cleanupProgressPct}%"></div>
          </div>
          <ul class="flex flex-col gap-1 max-h-64 overflow-auto" aria-label="Threads being removed">
            {#each run.items as item (item.id)}
              <li class="flex items-center gap-2 px-2 py-1.5 bg-card border border-border" data-testid="cleanup-item-{item.id}" data-state={item.state}>
                <span class="flex size-3 shrink-0 items-center justify-center">
                  {#if item.state === 'removing'}
                    <Pulse size="sm" motion="spin" />
                  {:else if item.state === 'done'}
                    <CheckIcon class="size-3 text-green-400" />
                  {:else if item.state === 'failed'}
                    <XIcon class="size-3 text-red-400" />
                  {:else if item.state === 'skipped'}
                    <MinusIcon class="size-3 text-muted-foreground" />
                  {:else}
                    <Pulse size="xs" tone="muted" motion="none" />
                  {/if}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="text-sm text-foreground truncate">{item.label}</div>
                  <div class="text-xs text-muted-foreground truncate" title={item.error}>
                    {item.project} ·
                    {#if item.state === 'removing'}
                      removing…
                    {:else if item.state === 'done'}
                      removed
                    {:else if item.state === 'failed'}
                      <span class="text-red-400">couldn't remove: {item.error}</span>
                    {:else if item.state === 'skipped'}
                      left alone: opened again
                    {:else}
                      waiting
                    {/if}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {:else}
      <div class="flex items-center gap-2">
        <Label class="shrink-0">Inactive for</Label>
        <input
          type="number"
          min="0"
          bind:value={cleanupDays}
          class="w-16 text-sm bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
        />
        <span class="text-xs text-muted-foreground">days</span>
        <Segmented.Root
          value={cleanupPresetValue}
          onValueChange={(v) => cleanupDays = v}
          aria-label="Inactive for"
          class="ml-1"
        >
          {#each cleanupDayPresets as d (d)}
            <Segmented.Item value={String(d)}>{d}</Segmented.Item>
          {/each}
        </Segmented.Root>
      </div>

      {#if cleanupCandidates.length === 0}
        <p class="text-sm text-muted-foreground py-2">No closed threads inactive for {cleanupDaysNum} days.</p>
      {:else}
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>{cleanupSelectedIds.length} of {cleanupCandidates.length} selected</span>
          <span class="flex items-center gap-2">
            <Button
              variant="quiet"
              size="inline"
              onclick={cleanupSelectAllClean}
              class="hover:underline"
              title="Tick every listed thread without uncommitted changes that isn't marked To do"
            >
              {cleanupSelectAllLabel}
            </Button>
            {#if cleanupGhAvailable}
              <span class="text-muted-foreground/40" aria-hidden="true">·</span>
              <!-- Purple, as merged pull requests are everywhere. -->
              <Button
                variant="link"
                size="inline"
                onclick={cleanupSelectMerged}
                disabled={cleanupMergedCount === 0}
                class="text-purple-400 hover:text-purple-300 disabled:no-underline"
                title="Tick only threads whose pull request has been merged (and that have no uncommitted changes and aren't marked To do)"
              >
                Select merged ({cleanupMergedCount})
              </Button>
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
                    <span data-testid="cleanup-pr-{session.id}">· no PR</span>
                  {:else if cleanupPr[session.id] === 'unknown'}
                    <span title="The GitHub CLI could not look up this branch's pull request (offline or not logged in)" data-testid="cleanup-pr-{session.id}">· PR unknown</span>
                  {/if}
                  {#if todoStore.has(session.id)}
                    <span class="text-foreground/80 font-medium" title="Marked To do in the sidebar" data-testid="cleanup-todo-{session.id}">· to do</span>
                  {/if}
                  {#if cleanupStatusUnknown[session.id]}
                    <span class="text-amber-500 font-medium" title="Git couldn't read this worktree's status, so it may have uncommitted changes">· changes unknown</span>
                  {:else if cleanupDirty[session.id]}
                    <span class="text-amber-500 font-medium">· uncommitted changes</span>
                  {/if}
                  {#if cleanupDeleteBranches && !session.direct}
                    {@const unmerged = cleanupUnmerged[session.id]}
                    {#if unmerged === null}
                      <span class="text-amber-500 font-medium" title="Git couldn't check this branch for commits that aren't on its base branch yet" data-testid="cleanup-commits-{session.id}">· commits unknown</span>
                    {:else if unmerged && unmerged.count > 0}
                      <span class="text-amber-500 font-medium" title="Unless you've pushed them, deleting the branch can lose them" data-testid="cleanup-commits-{session.id}">· {unmerged.count} {unmerged.count === 1 ? 'commit' : 'commits'} not on {unmerged.base}</span>
                    {/if}
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
      {/if}

      <Dialog.Footer>
        {#if cleanupStore.run}
          <Button variant="secondary" onclick={() => showCleanup = false}>Hide</Button>
        {:else}
          <Button variant="secondary" onclick={() => showCleanup = false}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={cleanupSelectedIds.length === 0 || cleanupCommitsPending}
            onclick={() => confirmCleanup = true}
          >
            {cleanupCommitsPending
              ? 'Checking commits…'
              : `Remove ${cleanupSelectedIds.length} ${cleanupSelectedIds.length === 1 ? 'thread' : 'threads'}`}
          </Button>
        {/if}
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Clean-up confirmation -->
{#if confirmCleanup}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmCleanup = false; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Remove Threads?</Dialog.Title>
        <Dialog.Description>
          Permanently remove {cleanupSelectedIds.length} {cleanupSelectedIds.length === 1 ? 'thread' : 'threads'} and {cleanupSelectedIds.length === 1 ? 'its worktree' : 'their worktrees'}{cleanupDeleteBranches ? ', and delete their branches' : ' (branches are kept)'}?
          {#if cleanupSelectedDirtyCount > 0}
            <span class="text-amber-500 font-medium">
              {cleanupSelectedDirtyCount} of them {cleanupSelectedDirtyCount === 1 ? 'has' : 'have'} uncommitted changes that will be lost.
            </span>
          {/if}
          {#if cleanupSelectedTodoCount > 0}
            <span class="text-foreground font-medium">
              {cleanupSelectedTodoCount} of them {cleanupSelectedTodoCount === 1 ? 'is' : 'are'} marked To do.
            </span>
          {/if}
          {#if cleanupDeleteBranches && cleanupSelectedUnmergedCount > 0}
            <span class="text-amber-500 font-medium">
              {#if cleanupSelectedUnmergedCount === 1}
                1 of them has commits that aren't on its base branch yet. Unless you've pushed them, deleting its branch can lose them.
              {:else}
                {cleanupSelectedUnmergedCount} of them have commits that aren't on their base branch yet. Unless you've pushed them, deleting their branches can lose them.
              {/if}
            </span>
          {/if}
          {#if cleanupDeleteBranches && cleanupSelectedCommitsUnknown > 0}
            <span class="text-amber-500 font-medium">
              Couldn't check {cleanupSelectedCommitsUnknown} of them for commits that aren't on the base branch yet.
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

<!-- Close confirmation: only asked when a conversation is working -->
{#if confirmClose}
  {@const { ids } = confirmClose}
  {@const one = ids.length === 1 ? store.sessions.find((s) => s.id === ids[0]) : null}
  {@const warning = closeWarning(confirmClose, !!one)}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmClose = null; }}>
    <Dialog.Content class="max-w-sm">
      <Dialog.Header>
        <Dialog.Title>{ids.length === 1 ? 'Close thread?' : `Close ${ids.length} threads?`}</Dialog.Title>
        <Dialog.Description>
          {#if one}
            <span class="text-foreground font-medium">{sessionRowLabel(one)}</span> {warning.why}.
            {warning.then} You can open it again later.
          {:else}
            {warning.why}.
            {warning.then} You can open them again later.
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmClose = null}>Cancel</Button>
        <Button variant="destructive" onclick={closeConfirmed}>Stop and close</Button>
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
        <Dialog.Title>Delete thread?</Dialog.Title>
        <Dialog.Description>
          {#if session?.noGit}
            This stops the thread and removes it. It worked in the project folder itself, so no files are deleted.
          {:else if session?.direct}
            This stops the thread and removes it. It worked in the project folder on
            <span class="text-foreground font-medium">{branch}</span>, so no files are deleted.
          {:else}
            This removes the thread and its copy of the project (the worktree for
            <span class="text-foreground font-medium">{branch}</span>).
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      {#if !session?.direct}
        {#if destroyCheckFailed.uncommitted}
          <p class="text-xs text-amber-500 mt-3" role="alert">
            Couldn't check the worktree for uncommitted changes. Any it has will be lost.
          </p>
        {:else if destroyUncommitted}
          <p class="text-xs text-amber-500 mt-3" role="alert">
            {destroyUncommitted} {destroyUncommitted === 1 ? 'file has' : 'files have'} uncommitted changes that will be lost.
          </p>
        {/if}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={deleteBranchOnDestroy} />
          Also delete the branch
        </label>
        {#if deleteBranchOnDestroy && destroyCheckFailed.unmerged && destroyMissingBase}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            This project has no branch named {destroyMissingBase}, so {branch} couldn't be checked for commits that
            aren't on it. If it uses another, change Default base branch in Settings (Git &amp; worktrees). Unless
            you've pushed them, deleting the branch can lose them.
          </p>
        {:else if deleteBranchOnDestroy && destroyCheckFailed.unmerged}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            Couldn't check whether {branch} has commits that aren't on its base branch. Unless you've pushed
            them, deleting the branch can lose them.
          </p>
        {:else if deleteBranchOnDestroy && destroyUnmerged?.count}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            {destroyUnmerged.count} {destroyUnmerged.count === 1 ? 'commit' : 'commits'} on {branch}
            {destroyUnmerged.count === 1 ? "isn't" : "aren't"} on {destroyUnmerged.base} yet. Unless you've pushed
            {destroyUnmerged.count === 1 ? 'it' : 'them'}, deleting the branch can lose {destroyUnmerged.count === 1 ? 'it' : 'them'}.
          </p>
        {/if}
        {#if destroyCheckFailed.linked}
          <p class="text-xs text-amber-500 mt-2" role="alert" data-testid="destroy-linked-failed">
            Couldn't check this thread's worktrees of other projects for uncommitted changes. They go with it, and any changes they have will be lost.
          </p>
        {:else if destroyLinked}
          {#each destroyLinked as link (link.repoPath)}
            {@const name = store.repoDisplayName(link.repoPath)}
            {#if link.uncommitted}
              <p class="text-xs text-amber-500 mt-2" role="alert" data-testid="destroy-linked-uncommitted">
                Its worktree of {name} goes too, and {link.uncommitted} {link.uncommitted === 1 ? 'file has' : 'files have'} uncommitted changes there that will be lost.
              </p>
            {/if}
            {#if deleteBranchOnDestroy && link.unmerged && link.base}
              <p class="text-xs text-amber-500 mt-2" role="alert">
                {link.unmerged} {link.unmerged === 1 ? 'commit' : 'commits'} on {link.branch ?? 'its branch'} in {name}
                {link.unmerged === 1 ? "isn't" : "aren't"} on {link.base} yet. The branch is deleted there too if this thread made it. Unless you've pushed
                {link.unmerged === 1 ? 'it' : 'them'}, that can lose {link.unmerged === 1 ? 'it' : 'them'}.
              </p>
            {/if}
          {/each}
        {/if}
        {#if destroyNeedsAnyway}
          <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
            <Checkbox bind:checked={destroyAnyway} />
            Delete anyway
          </label>
        {/if}
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmDestroyId = null}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={confirmDestroy} disabled={destroyChecking || (destroyNeedsAnyway && !destroyAnyway)}>
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
  {@const linkers = linkingThreads(confirmRemoveRepo)}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o && !removingRepo) confirmRemoveRepo = null; }}>
    <Dialog.Content class="max-w-sm">
      <Dialog.Header>
        <Dialog.Title>Remove project?</Dialog.Title>
        <Dialog.Description>
          Remove <span class="text-foreground font-medium">{store.repoDisplayName(confirmRemoveRepo)}</span> from Grove Bench?
          {#if n > 0}
            This also deletes its {n} {n === 1 ? 'thread' : 'threads'}{hasWorktrees ? ' and their copies of the project (worktrees)' : ''}.
          {/if}
          The project folder itself isn't touched.
        </Dialog.Description>
      </Dialog.Header>
      {#if removeRepoRechecked}
        <p class="text-xs text-muted-foreground mt-3">New threads started in this project, so it checked again.</p>
      {/if}
      {#if linkers.length}
        <!-- Main refuses too; caught here before any thread is deleted. -->
        <p class="text-xs text-amber-500 mt-3" role="alert" data-testid="remove-repo-linked">
          {linkers.length === 1 ? 'A thread in another project works' : `${linkers.length} threads in other projects work`} in this project:
          {linkers.map((s) => s.displayName || s.branch).join(', ')}. Delete {linkers.length === 1 ? 'it' : 'them'} first.
        </p>
      {/if}
      {#if running.length}
        <p class="text-xs text-amber-500 mt-3" role="alert">
          {running.length} {running.length === 1 ? 'thread is' : 'threads are'} running and will be stopped{midTurn ? `, ${midTurn} in the middle of a turn` : ''}.
        </p>
      {/if}
      {#if removeRepoDirty}
        <p class="text-xs text-amber-500 mt-3" role="alert">
          {removeRepoDirty} {removeRepoDirty === 1 ? 'thread has' : 'threads have'} uncommitted changes that will be lost.
        </p>
      {/if}
      {#if removeRepoCheckFailed.uncommitted}
        {@const failed = removeRepoCheckFailed.uncommitted}
        <p class="text-xs text-amber-500 mt-3" role="alert">
          Couldn't check {failed} {failed === 1 ? 'thread' : 'threads'} for uncommitted changes. Any {failed === 1 ? 'it has' : 'they have'} will be lost.
        </p>
      {/if}
      {#if hasWorktrees}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={removeRepoDeleteBranches} disabled={removingRepo} />
          Also delete their branches
        </label>
        {#if removeRepoDeleteBranches && removeRepoUnmerged?.count}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            {removeRepoUnmerged.count} {removeRepoUnmerged.count === 1 ? "branch has commits that aren't" : "branches have commits that aren't"} on {removeRepoUnmerged.base} yet.
            Unless you've pushed them, deleting the branches can lose them.
          </p>
        {/if}
        {#if removeRepoDeleteBranches && removeRepoCheckFailed.unmerged && removeRepoMissingBase}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            This project has no branch named {removeRepoMissingBase}, so its threads' branches couldn't be checked for
            commits that aren't on it. If it uses another, change Default base branch in Settings (Git &amp; worktrees).
            Unless you've pushed them, deleting the branches can lose them.
          </p>
        {:else if removeRepoDeleteBranches && removeRepoCheckFailed.unmerged}
          {@const failed = removeRepoCheckFailed.unmerged}
          <p class="text-xs text-amber-500 mt-2" role="alert">
            Couldn't check {failed} {failed === 1 ? 'branch' : 'branches'} for commits that aren't on {removeRepoUnmerged?.base ?? 'the base branch'} yet.
            Unless you've pushed them, deleting the branches can lose them.
          </p>
        {/if}
      {/if}
      {#if removeRepoNeedsAnyway}
        <label class="flex items-center gap-2 text-sm text-muted-foreground mt-3 cursor-pointer">
          <Checkbox bind:checked={removeRepoAnyway} disabled={removingRepo} />
          Remove anyway
        </label>
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmRemoveRepo = null} disabled={removingRepo}>
          Cancel
        </Button>
        <Button variant="destructive" onclick={confirmRemoveProject} disabled={linkers.length > 0 || removeRepoChecking || removingRepo || (removeRepoNeedsAnyway && !removeRepoAnyway)}>
          {removingRepo ? 'Removing…' : removeRepoChecking ? 'Checking…' : 'Remove'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
