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
  import PromptEditor from './PromptEditor.svelte';
  import { lazyComponent } from '../lib/lazy-component.js';
  import GitNotice from './GitNotice.svelte';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { conversationAgent } from '$lib/session-sprite-state.js';
  import type { GroveTab } from '$lib/agent-sprite.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { previewStore } from '../stores/preview.svelte.js';
  import { parseTabShortcut, type WorkspaceTab } from '$lib/keyboard-shortcuts.js';
  import { timeSteps, afterNextPaint } from '$lib/perf-timing.js';

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
  const TAB_HINT_CLASS = 'hidden @5xl:inline text-muted-foreground/60';

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
      messageStore.setIsRunning(sessionId, false);
    }
  });

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);
    // How long loading the history took, for the performance log.
    const timing = timeSteps('conversation view', sessionId);
    let eventCount = 0;
    // Before any await, so App covers the empty chat with the walk until the
    // history is in, rather than showing "Waiting for input...".
    messageStore.setHistoryLoaded(sessionId, false);

    // Always replay history on mount — clear any stale state first to avoid
    // duplicates. This is critical after refresh/restart where prior state is
    // lost but isReady might have been set by a leaked event.
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
      // missed; replay then fills in prior events. Caveat: a live event that
      // arrives during the awaited history fetch below is appended ahead of the
      // replayed history. In practice the window is tiny (system_init arrives
      // after mount) and the worst case is a single duplicated status line.
      messageStore.subscribe(sessionId);

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
      eventCount = page.events.length;
      messageStore.setPagination(sessionId, page.totalCount, page.startIndex);

      // Batch-replay events. replayEvents accumulates messages in a plain
      // array and flushes to the reactive store in one assignment at the end,
      // avoiding O(n²) array copies and hundreds of intermediate re-renders.
      messageStore.replayEvents(sessionId, page.events, skipDuringReplay, page.startIndex);
      if (page.events.length > 0) {
        const last = page.events[page.events.length - 1];
        if (last.type === 'result' || last.type === 'process_exit') {
          messageStore.setIsRunning(sessionId, false);
        }
      }
      // After replay, resolve any permissions/tool_calls still unresolved
      // (denied permissions have no tool_result, stopped sessions cleared theirs)
      messageStore.resolveStaleToolCalls(sessionId);
      backgroundTaskStore.resolveStale(sessionId, messageStore.getIsRunning(sessionId));
      messageStore.resolveReplayedPermissions(sessionId);
      timing.step('replay');

      // If the session is already running but system_init was missed during
      // replay (e.g. agent just connected, or SESSION_STATUS arrived during
      // the await above), ensure the input unlocks.
      const session = store.sessions.find((s) => s.id === sessionId);
      if (session && (session.status === 'running' || session.status === 'error') && !messageStore.getIsReady(sessionId)) {
        messageStore.setIsReady(sessionId, true);
        messageStore.setIsRunning(sessionId, false);
      }
    } catch (e: any) {
      console.error(`[WorkspacePane] history replay failed for ${sessionId}:`, e);
      messageStore.ingestEvent(sessionId, {
        type: 'error',
        message: `Failed to load conversation history: ${e?.message || e}`,
      });
    } finally {
      gitStatusStore.unsuppressRefresh(sessionId);
      messageStore.setHistoryLoaded(sessionId, true);
    }

    // Single git status refresh after replay (none without git)
    if (!noGit) gitStatusStore.refresh(sessionId);

    await afterNextPaint();
    timing.step('first draw');
    timing.done(`${eventCount} events, ${store.activeSessionId === sessionId ? 'shown' : 'hidden'}`);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    messageStore.unsubscribe(sessionId);
  });
</script>

{#snippet noGitNote(scene: GroveTab, tab: string, why: string)}
  {@const agent = settingsStore.current.groveCharacters ? conversationAgent(sessionId) : null}
  <div class="flex-1 flex items-center justify-center p-6">
    {#if agent}
      <!-- The conversation's agent on its bench, as in the sidebar: typing
           while it edits your files in place, sitting when it's idle. -->
      <GroveEmptyState variant="agent" {agent} tab={scene}>
        <p class="text-sm mt-5 mb-2 text-foreground/80">{tab} needs git</p>
        <p class="text-xs text-muted-foreground max-w-md">This conversation runs without git, so {why}</p>
      </GroveEmptyState>
    {:else}
      <div class="max-w-md text-center">
        <p class="text-sm text-foreground">{tab} needs git</p>
        <p class="text-xs text-muted-foreground mt-1">This conversation runs without git, so {why}</p>
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col h-full bg-background">
  <!-- Tab bar. The window can be 800px wide with the sidebar open, which
       leaves about 480px here: narrow, only the open tab keeps its label
       (the rest are icons, named for screen readers and in the tooltip),
       and the Alt+N hints show only when everything fits. -->
  <div class="@container flex items-center border-b border-border bg-card/50 shrink-0">
    <!-- The Thread tab carries its view picker while it is the open tab. -->
    <div class="flex items-stretch border-b-2 {activeTab === 'activity' ? 'border-primary' : 'border-transparent'}">
      <button
        onclick={() => switchTab('activity')}
        class="{activeTab === 'activity' ? 'pl-3 @3xl:pl-4 pr-1' : 'px-3 @3xl:px-4'} py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 {activeTab === 'activity'
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        title="Thread (Alt+1)"
      >
        <!-- A pixel chat bubble: two lines of text, tail at the bottom left. -->
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M4 4h16v2H4ZM2 6h2v16H2Zm18 0h2v10h-2ZM8 16h12v2H8Zm-2 2h2v2H6Zm-2 2h2v2H4ZM6 8h12v2H6Zm0 4h8v2H6Z"/></svg>
        <span class={tabLabelClass('activity')}>Thread</span>
        {#if hasPendingPermission}
          <span class="inline-block w-2 h-2 bg-amber-500 animate-pulse"></span>
        {:else if isRunning}
          <span class="inline-block w-2 h-2 bg-primary animate-pulse"></span>
        {/if}
        <span class="{TAB_HINT_CLASS} ml-1">Alt+1</span>
      </button>
      {#if activeTab === 'activity'}
        <ThreadViewSelect {sessionId} />
      {/if}
    </div>
    <button
      onclick={() => switchTab('changes')}
      class="px-3 @3xl:px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'changes'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
      title="Changes (Alt+2)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
      <span class={tabLabelClass('changes')}>Changes</span>
      {#if hasChanges}
        <span class="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none font-bold">
          {gitStatus.entries.length}
        </span>
      {/if}
      <span class="{TAB_HINT_CLASS} ml-1">Alt+2</span>
    </button>
    <button
      onclick={() => switchTab('checkpoints')}
      class="px-3 @3xl:px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'checkpoints'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
      title="Checkpoints (Alt+3)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
      <span class={tabLabelClass('checkpoints')}>Checkpoints</span>
      {#if checkpointCount > 0}
        <span class="bg-muted text-muted-foreground text-[10px] px-1.5 py-0.5 leading-none font-bold">
          {checkpointCount}
        </span>
      {/if}
      <span class="{TAB_HINT_CLASS} ml-1">Alt+3</span>
    </button>
    <button
      onclick={() => switchTab('terminal')}
      class="px-3 @3xl:px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'terminal'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
      title="Terminal (Alt+4)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><polyline points="4,6 10,12 4,18"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
      <span class={tabLabelClass('terminal')}>Terminal</span>
      {#if terminalRunning}
        <span class="inline-block w-2 h-2 bg-green-500 animate-pulse"></span>
      {/if}
      <span class="{TAB_HINT_CLASS} ml-1">Alt+4</span>
    </button>
    <button
      onclick={() => switchTab('preview')}
      class="px-3 @3xl:px-4 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 {activeTab === 'preview'
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
      title="Preview (Alt+5): browse your app, and watch the agent's page when it checks its work"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" class="shrink-0"><rect x="3" y="4" width="18" height="16"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="6" y1="6.5" x2="7" y2="6.5"/></svg>
      <span class={tabLabelClass('preview')}>Preview</span>
      {#if previewUnseen}
        <span class="inline-block w-2 h-2 bg-primary" title="The agent used the browser"></span>
      {:else if previewLoading}
        <span class="inline-block w-2 h-2 bg-primary/60 animate-pulse"></span>
      {/if}
      <span class="{TAB_HINT_CLASS} ml-1">Alt+5</span>
    </button>
  </div>

  <!-- Tab content -->
  <div class="flex-1 overflow-hidden flex flex-col {activeTab === 'activity' ? '' : 'hidden'}">
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
      {@render noGitNote('checkpoints', 'Checkpoints', 'no checkpoints are saved and file edits can\'t be restored. You can still rewind the conversation from a message in the Thread tab; files stay as they are.')}
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
    <div class="border-t border-border bg-card/50 px-4 py-2 shrink-0">
      <button
        onclick={() => switchTab('activity')}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Switch to Thread to send messages (Alt+1)
      </button>
    </div>
  {/if}
  {#if rewindOpened}
    {#await loadRewindDialog() then RewindDialog}
      <RewindDialog {sessionId} />
    {/await}
  {/if}
</div>
