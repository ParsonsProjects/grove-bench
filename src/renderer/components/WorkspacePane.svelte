<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { gitStatusStore } from '../stores/gitStatus.svelte.js';
  import { checkpointStore } from '../stores/checkpoints.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import OutputPanel from './OutputPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import ThreadViewSelect from './ThreadViewSelect.svelte';
  import ConversationGoal from './ConversationGoal.svelte';
  import GoalFlagIcon from './GoalFlagIcon.svelte';
  import { goalStore } from '../stores/goals.svelte.js';
  import PromptEditor from './PromptEditor.svelte';
  import { lazyComponent } from '../lib/lazy-component.js';
  import GitNotice from './GitNotice.svelte';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { conversationAgent } from '$lib/session-sprite-state.js';
  import type { GroveTab } from '$lib/agent-sprite.js';
  import type { AgentEvent } from '../../shared/types.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { previewStore } from '../stores/preview.svelte.js';
  import { parseTabShortcut, type WorkspaceTab } from '$lib/keyboard-shortcuts.js';
  import { timeSteps, afterNextPaint } from '$lib/perf-timing.js';
  import { tabTrigger } from '$lib/components/ui/tabs/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let { sessionId }: { sessionId: string } = $props();

  // What the tab strip shows as it widens (measured in the demo, with
  // badges on every tab): every label from 672px (about 650px needed), wider
  // padding and the Thread view's hidden count from 768px, and the Alt+N
  // hints from 1024px.
  /** Inactive tabs show only their icon when the strip is narrow. sr-only,
   *  not hidden, so screen readers still hear the tab's name. */
  function tabLabelClass(tab: WorkspaceTab): string {
    return activeTab === tab ? '' : 'sr-only @2xl:not-sr-only';
  }
  const TAB_HINT_CLASS = 'hidden @5xl:inline ml-1';
  /** Wider padding once the strip has room (see above). */
  const TAB_PAD_CLASS = '@3xl:px-4';

  let activeTab = $derived(messageStore.getActiveTab(sessionId));

  let gitStatus = $derived(gitStatusStore.getStatus(sessionId));
  let hasChanges = $derived(gitStatus.entries.length > 0);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let terminalRunning = $derived(terminalStore.isAlive(sessionId));
  let checkpointCount = $derived(checkpointStore.getCheckpoints(sessionId).length);
  let previewLoading = $derived(!!previewStore.getUser(sessionId)?.loading || !!previewStore.getAgent(sessionId)?.loading);
  let previewUnseen = $derived(previewStore.hasUnseenAgentActivity(sessionId));
  let previewVisible = $derived(activeTab === 'preview' && store.activeSessionId === sessionId);
  /** A conversation in a folder without git: nothing to diff, commit or
   *  checkpoint, so those tabs say why instead of loading. */
  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let noGit = $derived(!!session?.noGit);

  // Derive whether there's an unresolved permission request
  let hasPendingPermission = $derived(messageStore.hasPendingPermission(sessionId));

  // TerminalPanel spawns a shell process and an xterm instance on mount. Every
  // live session's pane is mounted at once, so defer that until the Terminal
  // tab is first opened for this session; once mounted it stays mounted.
  let terminalMounted = $state(false);
  $effect(() => {
    if (activeTab === 'terminal') terminalMounted = true;
  });

  // The terminal (and xterm, its largest library) loads on first visit.
  const loadTerminalPanel = lazyComponent(() => import('./TerminalPanel.svelte'));

  // The Changes and Checkpoints tabs load and mount on first visit too: their
  // data lives in stores, so nothing is lost before then, and until visited
  // their code stays out of startup.
  const loadChangesPanel = lazyComponent(() => import('./ChangesReviewPanel.svelte'));
  const loadCheckpointsPanel = lazyComponent(() => import('./CheckpointsPanel.svelte'));
  let changesMounted = $state(false);
  let checkpointsMounted = $state(false);
  $effect(() => {
    if (activeTab === 'changes') changesMounted = true;
    if (activeTab === 'checkpoints') checkpointsMounted = true;
  });

  // The Preview panel mounts on first open too. Its pages live in the main
  // process, so nothing is lost before then.
  let previewMounted = $state(false);
  // Loaded when first needed: the Preview tab's first visit, the first rewind.
  const loadPreviewPanel = lazyComponent(() => import('./PreviewPanel.svelte'));
  const loadRewindDialog = lazyComponent(() => import('./RewindDialog.svelte'));
  let rewindOpened = $state(false);
  $effect(() => { if (messageStore.rewindDialogOpen[sessionId]) rewindOpened = true; });
  $effect(() => {
    if (activeTab === 'preview') previewMounted = true;
  });

  function switchTab(tab: WorkspaceTab) {
    if (tab === activeTab) return;
    messageStore.setActiveTab(sessionId, tab);
    if (noGit) return;
    if (tab === 'changes') {
      gitStatusStore.refresh(sessionId);
    }
    if (tab === 'checkpoints') {
      checkpointStore.refresh(sessionId);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Every session's WorkspacePane is mounted at once (inactive ones hidden via
    // CSS), so this window listener must ignore events unless this pane is the
    // active session — otherwise Alt+<n> switches tabs on every session.
    if (store.activeSessionId !== sessionId) return;
    const tab = parseTabShortcut(e);
    if (tab) { e.preventDefault(); switchTab(tab); }
  }

  // Reactively unlock the input whenever the session reaches 'running' (or 'error')
  // status. This covers race conditions where SESSION_STATUS arrives before or after
  // mount, or where clearSession resets isReady after it was already set.
  // IMPORTANT: read `ready` outside the condition so Svelte always tracks isReady
  // as a dependency — otherwise short-circuit evaluation when status is 'starting'
  // causes isReady changes to be missed.
  $effect(() => {
    const session = store.sessions.find((s) => s.id === sessionId);
    const ready = messageStore.getIsReady(sessionId);
    if (session && (session.status === 'running' || session.status === 'error') && !ready) {
      messageStore.setIsReady(sessionId, true);
      // A prompt waiting on its reply (a new thread's first) keeps it
      // working: the agent coming up is when it starts on it.
      if (session.status === 'error' || !messageStore.isAwaitingResponse(sessionId)) {
        messageStore.setIsRunning(sessionId, false);
      }
    }
  });

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);
    // How long loading the history took, for the performance log.
    const timing = timeSteps('conversation view', sessionId);
    let eventCount = 0;
    let historyFailed = false;
    // Before any await, so App covers the empty chat with the walk until the
    // history is in, rather than showing "Waiting for input...".
    messageStore.setHistoryLoaded(sessionId, false);

    // Always replay history on mount — clear any stale state first to avoid
    // duplicates. This is critical after refresh/restart where prior state is
    // lost but isReady might have been set by a leaked event.
    /** The page replayed, for sorting out live events held meanwhile. */
    let replayedPage: AgentEvent[] | null = null;
    // The prompt waiting on a reply, as the chat shows it before it's
    // cleared, to look for its turn's end in the page (see below).
    const waitingOn = messageStore.pendingPrompt(sessionId);
    try {
      // Clear existing messages so replay starts fresh.
      // clearSession does NOT reset isReady — that's handled below based on
      // actual session state to avoid racing with the SESSION_STATUS handler.
      messageStore.clearSession(sessionId);

      // Reset isReady ONLY for sessions that haven't reached 'running' yet.
      // For sessions already 'running' or 'error', isReady should stay true
      // (or be set true below) so the input doesn't flicker disabled.
      const sessionBefore = store.sessions.find((s) => s.id === sessionId);
      if (!sessionBefore || (sessionBefore.status !== 'running' && sessionBefore.status !== 'error')) {
        messageStore.setIsReady(sessionId, false);
      }

      // Subscribe to live events BEFORE replaying history so events for a
      // session still being set up (worktree creation, npm install) aren't
      // missed. Ones that arrive while the page loads are held, then shown
      // after the replay unless the page already has them: a new
      // conversation's first events land in that window, and were shown
      // twice.
      messageStore.subscribe(sessionId);
      messageStore.holdLiveEvents(sessionId);

      // Suppress this session's git refreshes during replay to avoid N IPC
      // calls (per-session so concurrent pane mounts don't clear each other's).
      gitStatusStore.suppressRefresh(sessionId);

      // Load only the most recent events to avoid stalling on large histories.
      // Older events are loaded on demand when the user scrolls up.
      const INITIAL_PAGE_SIZE = 200;
      const skipDuringReplay = new Set([
        'partial_text', 'activity', 'tool_progress', 'usage',
      ]);

      const page = await window.groveBench.getEventHistoryPage(sessionId, INITIAL_PAGE_SIZE);
      timing.step('history fetch');
      // A prompt sent that main hadn't finished when it answered (see
      // applyTurnState). Read before the replay, whose results clear it.
      const promptSent = messageStore.stillAwaitingResponse(sessionId, waitingOn, page.events);
      eventCount = page.events.length;
      messageStore.setPagination(sessionId, page.totalCount, page.startIndex);

      // Batch-replay events. replayEvents accumulates messages in a plain
      // array and flushes to the reactive store in one assignment at the end,
      // avoiding O(n²) array copies and hundreds of intermediate re-renders.
      messageStore.replayEvents(sessionId, page.events, skipDuringReplay, page.startIndex);
      replayedPage = page.events;
      // Whether a turn is running, and which prompts still wait on the user,
      // come from main, read with the page: a history cut off mid-turn (the
      // app quit or was killed) ends just like a turn still running. Tool
      // calls and prompts nothing answered are settled accordingly. Live
      // events held meanwhile go on from here when released below.
      messageStore.applyTurnState(sessionId, page.turn, promptSent);
      // Background tasks (a dev server) run on between turns while the
      // agent's process is up, so they go only once it is gone.
      backgroundTaskStore.resolveStale(sessionId, page.turn.agentLive);
      timing.step('replay');

      // If the session is already running but system_init was missed during
      // replay (e.g. agent just connected, older than the page, or
      // SESSION_STATUS arrived during the await above), ensure the input
      // unlocks. Whether a turn is running is main's answer above.
      const session = store.sessions.find((s) => s.id === sessionId);
      if (session && (session.status === 'running' || session.status === 'error') && !messageStore.getIsReady(sessionId)) {
        messageStore.setIsReady(sessionId, true);
      }
    } catch (e: any) {
      historyFailed = true;
      console.error(`[WorkspacePane] history replay failed for ${sessionId}:`, e);
      messageStore.ingestEvent(sessionId, {
        type: 'error',
        message: `Failed to load thread history: ${e?.message || e}`,
      });
    } finally {
      messageStore.releaseLiveEvents(sessionId, replayedPage);
      gitStatusStore.unsuppressRefresh(sessionId);
      messageStore.setHistoryLoaded(sessionId, true);
    }

    // Single git status refresh after replay (none without git)
    if (!noGit) gitStatusStore.refresh(sessionId);

    // A minimized window draws nothing until it's restored: that wait isn't
    // drawing time, so there is no first draw to time then.
    const minimized = document.hidden;
    if (!minimized) {
      await afterNextPaint();
      // Closed before it drew: there is no first draw to report, and the
      // pane on screen by now (or a test after this one) isn't this one.
      if (destroyed) return;
      timing.step('first draw');
    }
    const where = minimized ? 'window minimized' : store.activeSessionId === sessionId ? 'shown' : 'behind another conversation';
    timing.done(`${historyFailed ? 'history failed' : `${eventCount} events`}, ${where}`);
  });

  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    window.removeEventListener('keydown', handleKeydown);
    messageStore.unsubscribe(sessionId);
    // The thread was closed or deleted (its row stopped or gone): a prompt
    // sent to it gets no reply now, and must not leave it working when
    // reopened. A pane remounted while its thread lives on (after a render
    // error) keeps it: the agent is still on that prompt.
    const row = store.sessions.find((s) => s.id === sessionId);
    if (!row || row.status === 'stopped') messageStore.dropAwaitingResponse(sessionId);
  });
</script>

{#snippet noGitNote(scene: GroveTab, tab: string, why: string)}
  {@const agent = settingsStore.current.groveCharacters ? conversationAgent(sessionId) : null}
  <div class="flex-1 flex items-center justify-center p-6">
    {#if agent}
      <!-- The conversation's agent on its bench, as in the sidebar: typing
           while it edits your files in place, sitting when it's idle. -->
      <GroveEmptyState variant="agent" {agent} tab={scene}>
        <p class="font-pixel text-base mt-5 mb-2 text-foreground/90">{tab} needs git</p>
        <p class="text-xs text-muted-foreground max-w-md">This thread runs without git, so {why}</p>
      </GroveEmptyState>
    {:else}
      <div class="max-w-md text-center">
        <p class="text-sm text-foreground">{tab} needs git</p>
        <p class="text-xs text-muted-foreground mt-1">This thread runs without git, so {why}</p>
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col h-full bg-background">
  <!-- Tab bar. The window can be 800px wide with the sidebar open, which
       leaves about 480px here: narrow, only the open tab keeps its label
       (the rest are icons, named for screen readers and in the tooltip),
       and the Alt+N hints show only when everything fits. -->
  <div class="@container flex items-stretch border-b border-border bg-card/50 shrink-0">
    <!-- The Thread tab carries its view picker while it is the open tab, so
         the wrapper draws the underline and the button inside it doesn't. -->
    <div class="-mb-px flex items-stretch border-b-2 {activeTab === 'activity' ? 'border-primary' : 'border-transparent'}">
      <button
        onclick={() => switchTab('activity')}
        class={tabTrigger({
          active: activeTab === 'activity',
          class: `mb-0 border-b-0 ${activeTab === 'activity' ? 'pl-3 @3xl:pl-4 pr-1' : TAB_PAD_CLASS}`,
        })}
        title="Thread (Alt+1)"
      >
        <!-- A pixel chat bubble: two lines of text, tail at the bottom left. -->
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M4 4h16v2H4ZM2 6h2v16H2Zm18 0h2v10h-2ZM8 16h12v2H8Zm-2 2h2v2H6Zm-2 2h2v2H4ZM6 8h12v2H6Zm0 4h8v2H6Z"/></svg>
        <span class={tabLabelClass('activity')}>Thread</span>
        {#if hasPendingPermission}
          <Pulse tone="attention" size="sm" />
        {:else if isRunning}
          <Pulse size="sm" />
        {/if}
        <Kbd keys="Alt+1" class={TAB_HINT_CLASS} />
      </button>
      {#if activeTab === 'activity'}
        <ThreadViewSelect {sessionId} />
        {#if settingsStore.current.showConversationGoal && goalStore.get(sessionId).hidden}
          <!-- The goal bar was closed for this conversation: bring it back. -->
          <Button
            variant="quiet"
            size="icon-2xs"
            onclick={() => goalStore.setHidden(sessionId, false)}
            class="self-center mr-2"
            title="Show the thread goal"
            aria-label="Show the thread goal"
          >
            <GoalFlagIcon />
          </Button>
        {/if}
      {/if}
    </div>
    <button
      onclick={() => switchTab('changes')}
      class={tabTrigger({ active: activeTab === 'changes', class: TAB_PAD_CLASS })}
      title="Changes (Alt+2)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
      <span class={tabLabelClass('changes')}>Changes</span>
      {#if hasChanges}
        <Badge variant="solid" tone="primary" count>{gitStatus.entries.length}</Badge>
      {/if}
      <Kbd keys="Alt+2" class={TAB_HINT_CLASS} />
    </button>
    <button
      onclick={() => switchTab('checkpoints')}
      class={tabTrigger({ active: activeTab === 'checkpoints', class: TAB_PAD_CLASS })}
      title="Checkpoints (Alt+3)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
      <span class={tabLabelClass('checkpoints')}>Checkpoints</span>
      {#if checkpointCount > 0}
        <Badge variant="solid" tone="muted" count>{checkpointCount}</Badge>
      {/if}
      <Kbd keys="Alt+3" class={TAB_HINT_CLASS} />
    </button>
    <button
      onclick={() => switchTab('terminal')}
      class={tabTrigger({ active: activeTab === 'terminal', class: TAB_PAD_CLASS })}
      title="Terminal (Alt+4)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><polyline points="4,6 10,12 4,18"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
      <span class={tabLabelClass('terminal')}>Terminal</span>
      {#if terminalRunning}
        <Pulse size="sm" />
      {/if}
      <Kbd keys="Alt+4" class={TAB_HINT_CLASS} />
    </button>
    <button
      onclick={() => switchTab('preview')}
      class={tabTrigger({ active: activeTab === 'preview', class: TAB_PAD_CLASS })}
      title="Preview (Alt+5): browse your app, and watch the agent's page when it checks its work"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><rect x="3" y="4" width="18" height="16"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="6" y1="6.5" x2="7" y2="6.5"/></svg>
      <span class={tabLabelClass('preview')}>Preview</span>
      {#if previewUnseen}
        <span class="inline-block w-2 h-2 bg-primary" title="The agent used the browser"></span>
      {:else if previewLoading}
        <Pulse size="sm" />
      {/if}
      <Kbd keys="Alt+5" class={TAB_HINT_CLASS} />
    </button>
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
    <ConversationGoal {sessionId} />
    <OutputPanel {sessionId} />
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'changes' ? '' : 'hidden'}">
    <GitNotice />
    {#if noGit}
      {@render noGitNote('changes', 'Changes', 'there is nothing to compare the files against. The agent edits your files in place; check them in your editor or file explorer.')}
    {:else if changesMounted}
      {#await loadChangesPanel() then ChangesReviewPanel}
        <ChangesReviewPanel {sessionId} />
      {/await}
    {/if}
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'checkpoints' ? '' : 'hidden'}">
    {#if noGit}
      {@render noGitNote('checkpoints', 'Checkpoints', 'no checkpoints are saved and file edits can\'t be restored. You can still rewind the thread from a message in the Thread tab; files stay as they are.')}
    {:else if checkpointsMounted}
      {#await loadCheckpointsPanel() then CheckpointsPanel}
        <CheckpointsPanel {sessionId} />
      {/await}
    {/if}
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'terminal' ? '' : 'hidden'}">
    {#if terminalMounted}
      {#await loadTerminalPanel() then TerminalPanel}
        <TerminalPanel {sessionId} />
      {/await}
    {/if}
  </div>
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'preview' ? '' : 'hidden'}">
    {#if previewMounted}
      {#await loadPreviewPanel() then PreviewPanel}
        <PreviewPanel {sessionId} active={previewVisible} />
      {/await}
    {/if}
  </div>

  <StatusBar {sessionId} />
  {#if activeTab === 'activity' || activeTab === 'changes' || activeTab === 'preview'}
    <!-- The Changes and Preview tabs share the prompt input; sending from them
         jumps back to Activity (handled in PromptEditor) so the response is visible. -->
    <PromptEditor {sessionId} />
  {:else if activeTab === 'terminal'}
    <!-- Terminal has its own input -->
  {:else}
    <div class="border-t border-border bg-card/50 px-4 py-2 shrink-0 text-xs">
      <Button variant="quiet" size="inline" onclick={() => switchTab('activity')}>
        Switch to Thread to send messages (Alt+1)
      </Button>
    </div>
  {/if}
  {#if rewindOpened}
    {#await loadRewindDialog() then RewindDialog}
      <RewindDialog {sessionId} />
    {/await}
  {/if}
</div>
