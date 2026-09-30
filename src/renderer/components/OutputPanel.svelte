<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import UserPromptBlock from './UserPromptBlock.svelte';
  import AssistantTextBlock from './AssistantTextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';
  import QuestionBlock from './QuestionBlock.svelte';
  import ElicitationBlock from './ElicitationBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import SystemBlock from './SystemBlock.svelte';
  import GitIdentityNotice from './GitIdentityNotice.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import MessageSearchBar from './MessageSearchBar.svelte';
  import SelectionMenu from './SelectionMenu.svelte';
  import ActivityContextMenu from './ActivityContextMenu.svelte';
  import GroveWalk from './GroveWalk.svelte';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { arrivalScene } from '../stores/arrivalScene.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { filterVisibleMessages, hasAgentReply } from '$lib/message-view.js';
  import { sessionRepoColor } from '$lib/session-repo-color.js';
  import { sessionSpriteState } from '$lib/session-sprite-state.js';
  import type { EventSearchHit } from '../../shared/types.js';

  let { sessionId }: { sessionId: string } = $props();

  let scrollContainer = $state<HTMLDivElement>();
  let shouldAutoScroll = $state(true);

  let allMessages = $derived(messageStore.getMessages(sessionId));
  let streamingText = $derived(messageStore.getStreamingText(sessionId));
  // Every conversation's pane stays mounted, hidden but for the open one.
  // A hidden one skips drawing its live reply (re-parsed on every flush);
  // shown again, it draws what has arrived so far.
  let paneShown = $derived(store.activeSessionId === sessionId && messageStore.getActiveTab(sessionId) === 'activity');
  let streamingThinking = $derived(messageStore.getStreamingThinking(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));

  // View mode — Detailed shows everything; Summary hides thinking & most tool
  // calls; Focus shows only assistant text, questions (with answers) and
  // unanswered permissions.
  // The toggle lives in the status bar; the default comes from settings.
  let viewMode = $derived(messageStore.getViewMode(sessionId));
  let filteredMessages = $derived(filterVisibleMessages(allMessages, viewMode));
  let summaryMode = $derived(viewMode !== 'detailed');

  // ─── Lazy loading: only render recent messages, load older on demand ───
  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);
  let hasOlderMessages = $derived(filteredMessages.length > visibleCount);
  let messages = $derived(
    hasOlderMessages
      ? filteredMessages.slice(filteredMessages.length - visibleCount)
      : filteredMessages
  );
  let olderCount = $derived(
    hasOlderMessages ? filteredMessages.length - visibleCount : 0
  );

  // Whether there are older events on disk that haven't been loaded into the store yet
  let hasUnloadedEvents = $derived(messageStore.hasOlderEvents(sessionId));
  let unloadedEventCount = $derived(messageStore.olderEventCount(sessionId));
  let isLoadingOlderEvents = $derived(messageStore.isLoadingOlder(sessionId));

  // ─── First turn: the agent walks to its bench (stores/arrivalScene) ───
  // Stands in for the empty chat and the working row until the first reply
  // shows, as the view mode shows it: in Summary, say, a first turn of reads
  // keeps the scene up. Live thinking doesn't end it; the caption says
  // "Thinking..." instead.
  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let agentLive = $derived(session?.status === 'starting' || session?.status === 'installing' || session?.status === 'running');
  let replied = $derived(hasAgentReply(filteredMessages) || !!streamingText || hasUnloadedEvents);
  let arrival = $derived(
    settingsStore.current.groveCharacters && agentLive && !replied ? arrivalScene.for(sessionId) : null,
  );

  // Starting a conversation with a message begins the scene (see
  // draftStore.start): the message only shows once the agent is ready, so
  // there is nothing here to go on before then. A first message sent later,
  // in a conversation started without one, begins it here. It ends at the
  // reply, or when the agent stops or goes to sleep without one; Stop ends
  // it too (PromptEditor).
  $effect(() => {
    if (replied || !agentLive) {
      untrack(() => arrivalScene.end(sessionId));
    } else if (isRunning && allMessages.some((m) => m.kind === 'user')) {
      untrack(() => arrivalScene.begin(sessionId));
    }
  });
  onDestroy(() => arrivalScene.end(sessionId));

  // Reset visible count when switching sessions
  $effect(() => {
    sessionId; // track
    visibleCount = PAGE_SIZE;
  });

  async function expandVisibleCount(newCount: number) {
    const prevScrollHeight = scrollContainer?.scrollHeight ?? 0;
    visibleCount = Math.min(newCount, filteredMessages.length);
    await tick();
    if (scrollContainer) {
      scrollContainer.scrollTop += scrollContainer.scrollHeight - prevScrollHeight;
    }
  }

  function loadOlderMessages() {
    expandVisibleCount(visibleCount + PAGE_SIZE);
  }

  function showAllMessages() {
    expandVisibleCount(filteredMessages.length);
  }

  async function loadOlderEvents() {
    const prevScrollHeight = scrollContainer?.scrollHeight ?? 0;
    await messageStore.loadOlderEvents(sessionId);
    // Show all messages after loading older events (they're already in the store)
    visibleCount = filteredMessages.length;
    await tick();
    if (scrollContainer) {
      scrollContainer.scrollTop += scrollContainer.scrollHeight - prevScrollHeight;
    }
  }

  // Message search state — results come from the main-process full-history
  // search (dropdown in MessageSearchBar); currentMatchId rings the jumped-to row.
  let searchOpen = $state(false);
  let currentMatchId = $state<string | null>(null);

  /** Jump to a search result: page in only as deep as the match, reveal it, scroll. */
  async function handleJump(hit: EventSearchHit) {
    await jumpToEventIndex(hit.eventIndex);
  }

  /** Page in to the given event index, reveal the message it produced and scroll
   *  to it. Returns true if the message was located, false otherwise (so callers
   *  can re-resolve a stale index or fall back). */
  async function jumpToEventIndex(eventIndex: number): Promise<boolean> {
    await messageStore.loadOlderUntil(sessionId, eventIndex);
    const id = await messageStore.findMessageForEvent(sessionId, eventIndex);
    if (!id) return false;

    // The target may be hidden by the current view mode (thinking or a
    // filtered tool call). Reveal details so it can be scrolled to.
    if (viewMode !== 'detailed' && !filteredMessages.some((m) => m.id === id)) {
      messageStore.setViewMode(sessionId, 'detailed');
      await tick();
    }
    // If the target is older than the rendered window, expand to include it.
    if (hasOlderMessages && !messages.some((m) => m.id === id)) {
      const matchIdx = filteredMessages.findIndex((m) => m.id === id);
      if (matchIdx >= 0) {
        visibleCount = Math.max(visibleCount, filteredMessages.length - matchIdx);
      }
      await tick();
    }
    currentMatchId = id;
    // Stop following new output, or the next streamed chunk snaps back to the
    // bottom before the smooth scroll has moved far enough to say so itself.
    shouldAutoScroll = false;
    requestAnimationFrame(() => {
      const el = scrollContainer?.querySelector(`[data-msg-id="${id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return true;
  }

  // ─── Bookmark jump (cross-session, driven by messageStore.pendingJumpBySession) ───
  let fallbackBookmarkText = $state<string | null>(null);
  let jumpInFlight = false;

  // Bookmark jumps ring the target, then clear on the next user scroll/click
  // (unlike search, which keeps the ring while you navigate between results).
  // Armed after the jump's own programmatic scrollIntoView so only genuine user
  // gestures (wheel / mousedown) dismiss it — scrollIntoView fires neither.
  let clearHighlightOnInteraction = false;
  function maybeClearHighlight() {
    if (!clearHighlightOnInteraction) return;
    clearHighlightOnInteraction = false;
    currentMatchId = null;
  }

  $effect(() => {
    const req = messageStore.pendingJumpBySession[sessionId];
    // Track message count so a jump requested before history replay retries once
    // the pane's history finishes loading.
    const _loaded = messageStore.getMessages(sessionId).length;
    if (!req || store.activeSessionId !== sessionId || jumpInFlight) return;
    jumpInFlight = true;
    (async () => {
      try {
        let next: JumpRequest | undefined = req;
        while (next) {
          await resolveBookmarkJump(next);
          // A jump asked for while this one ran was skipped above: take it now.
          const pending: JumpRequest | undefined = messageStore.pendingJumpBySession[sessionId];
          next = pending && !sameJump(pending, next) && store.activeSessionId === sessionId ? pending : undefined;
        }
      } finally {
        jumpInFlight = false;
      }
    })();
  });

  type JumpRequest = { eventIndex: number | null; uuid: string | null; bookmarkId: string };
  // By fields: search hits all share bookmarkId ''.
  function sameJump(a: JumpRequest, b: JumpRequest): boolean {
    return a.eventIndex === b.eventIndex && a.uuid === b.uuid && a.bookmarkId === b.bookmarkId;
  }
  /** Clear `req` once handled, but not a newer request that replaced it. */
  function finishJump(req: JumpRequest) {
    const pending = messageStore.pendingJumpBySession[sessionId];
    if (pending && sameJump(pending, req)) messageStore.clearJump(sessionId);
  }

  async function resolveBookmarkJump(req: JumpRequest) {
    // Resolve to a concrete event index — cached first, then via the durable uuid.
    let eventIndex = req.eventIndex;
    if (eventIndex == null && req.uuid) {
      eventIndex = await window.groveBench.findEventIndexByUuid(sessionId, req.uuid);
      if (eventIndex != null) bookmarkStore.patchEventIndex(req.bookmarkId, eventIndex);
    }
    if (eventIndex == null) {
      showBookmarkFallback(req.bookmarkId);
      finishJump(req);
      return;
    }

    if (await jumpToEventIndex(eventIndex)) {
      clearHighlightOnInteraction = true;
      finishJump(req);
      return;
    }

    // Cached index was stale (history shifted) — re-resolve via uuid once.
    if (req.uuid) {
      const ei = await window.groveBench.findEventIndexByUuid(sessionId, req.uuid);
      if (ei != null && ei !== eventIndex) {
        bookmarkStore.patchEventIndex(req.bookmarkId, ei);
        if (await jumpToEventIndex(ei)) {
          clearHighlightOnInteraction = true;
          finishJump(req);
          return;
        }
      }
    }

    // Still not found. If the pane simply hasn't replayed history yet, keep the
    // request pending so the effect retries when messages arrive; otherwise the
    // source is genuinely gone (e.g. cleared history) → show the stored text.
    if (messageStore.getMessages(sessionId).length === 0) return;
    showBookmarkFallback(req.bookmarkId);
    finishJump(req);
  }

  function showBookmarkFallback(bookmarkId: string) {
    const bm = bookmarkStore.list.find((b) => b.id === bookmarkId);
    fallbackBookmarkText = bm?.selectedText ?? null;
  }

  // Text-selection actions (Bookmark / To prompt) are handled by the reusable
  // SelectionMenu component, mounted below with this pane's scroll container.

  function closeSearch() {
    searchOpen = false;
    currentMatchId = null;
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    // Inactive session panes stay mounted (hidden via CSS); only the active
    // session should toggle its search bar on Ctrl/Cmd+F, and only while its
    // Activity tab is showing (other tabs hide this pane the same way).
    if (store.activeSessionId !== sessionId) return;
    if (messageStore.getActiveTab(sessionId) !== 'activity') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchOpen = !searchOpen;
      if (!searchOpen) currentMatchId = null;
    }
    if (e.key === 'Escape') {
      fallbackBookmarkText = null;
      clearHighlightOnInteraction = false;
      currentMatchId = null;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleSearchKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleSearchKeydown);
  });

  // Re-enable auto-scroll when the user sends a message
  // Track filteredMessages (not the sliced `messages`) to avoid false triggers
  // when the user loads older messages and the visible window grows.
  let prevMsgCount = $state(0);
  $effect(() => {
    const len = filteredMessages.length;
    if (len > prevMsgCount) {
      const last = filteredMessages[len - 1];
      if (last?.kind === 'user') {
        untrack(followLatest);
      } else if (!untrack(() => shouldAutoScroll) && untrack(() => hasOlderMessages)) {
        // Scrolled up to read: grow the window instead of sliding it, so the
        // oldest rendered message (maybe the one being read) stays put.
        untrack(() => { visibleCount += len - prevMsgCount; });
      }
    }
    prevMsgCount = len;
  });

  $effect(() => {
    const _len = messages.length;
    const _st = streamingText;
    const _stk = streamingThinking; // follow the live thinking line as it grows
    if (shouldAutoScroll && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  // The effect above can't scroll while the chat is hidden (another
  // conversation or tab is open): a hidden element has no layout, so the
  // write is dropped, and on showing it the browser restores the old offset.
  // Output that arrived meanwhile then sits below the view, and a pane that
  // loaded its history while hidden opens at the top. Showing it resizes the
  // container from 0, so pin to the bottom then, and on any other resize
  // (window, prompt box), while following the conversation.
  $effect(() => {
    const el = scrollContainer;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (shouldAutoScroll && el.clientHeight > 0) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Thread images (attachments, tool screenshots) load after the scroll
  // above and make the content taller without resizing the container, so
  // the observer doesn't see them. Stay at the bottom when following. A
  // frame later, so a failed image's placeholder has replaced it by then.
  function followImageLoad(e: Event) {
    if (!(e.target instanceof HTMLImageElement)) return;
    requestAnimationFrame(() => {
      if (shouldAutoScroll && scrollContainer && scrollContainer.clientHeight > 0) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });
  }

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // Hidden: no layout, so this says nothing about where the user is.
    if (clientHeight === 0) return;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 100;
  }

  function scrollToBottom() {
    if (scrollContainer) {
      followLatest();
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  /** Back to the live end: follow new output and render only the latest page
   *  again, so a window grown by reading back (loading older messages, or
   *  output arriving while scrolled up) doesn't stay large for the rest of
   *  the session. Only on a deliberate return (sending, Scroll to bottom):
   *  a jump's smooth scroll passes near the bottom and would lose its target. */
  function followLatest() {
    shouldAutoScroll = true;
    visibleCount = PAGE_SIZE;
  }
</script>

{#if searchOpen}
  <MessageSearchBar {sessionId} onclose={closeSearch} onjump={handleJump} />
{/if}

<div class="flex-1 relative overflow-hidden">
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pixel-bg h-full overflow-y-auto overflow-x-hidden px-4 py-3 relative"
  class:flex={arrival !== null}
  class:flex-col={arrival !== null}
  bind:this={scrollContainer}
  onscroll={handleScroll}
  onloadcapture={followImageLoad}
  onerrorcapture={followImageLoad}
  onmousedown={maybeClearHighlight}
  onwheel={maybeClearHighlight}
>
  <!-- Clipped to the view: the dots reach 726px down, and unclipped they
       made a short chat scroll, so following it hid the first messages. -->
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    {#each Array(20) as _, i}
      <span
        class="blue-pixel absolute"
        style="
          width: 4px; height: 4px;
          top: {Math.round((8 + (((i * 37 + 13) * 7) % 84)) / 100 * 800 / 6) * 6}px;
          left: {Math.round((5 + (((i * 53 + 7) * 11) % 90)) / 100 * 1400 / 6) * 6}px;
          animation-delay: {(i * 1.3) % 6}s;
        "
      ></span>
    {/each}
  </div>

  {#if messages.length === 0 && !streamingText && arrival === null}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      <div class="text-center relative z-10">
        <p class="text-sm mb-1 opacity-60">Waiting for input...</p>
        <p class="text-xs opacity-40">Type a message below to start the conversation.</p>
      </div>
    </div>
  {/if}

  {#if hasUnloadedEvents}
    <div class="flex items-center justify-center gap-2 py-2 relative z-10">
      <button
        onclick={loadOlderEvents}
        disabled={isLoadingOlderEvents}
        class="px-3 py-1 text-xs font-medium border border-border bg-card/80 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-50"
      >
        {isLoadingOlderEvents ? 'Loading...' : `\u2191 Load ${unloadedEventCount} older events from history`}
      </button>
    </div>
  {/if}

  {#if hasOlderMessages}
    <div class="flex items-center justify-center gap-2 py-2 relative z-10">
      <button
        onclick={loadOlderMessages}
        class="px-3 py-1 text-xs font-medium border border-border bg-card/80 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
      >
        &uarr; Load {Math.min(PAGE_SIZE, olderCount)} older messages
      </button>
      {#if olderCount > PAGE_SIZE}
        <button
          onclick={showAllMessages}
          class="px-3 py-1 text-xs font-medium border border-border bg-card/80 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
        >
          Show all ({olderCount})
        </button>
      {/if}
    </div>
  {/if}

  {#each messages as msg (msg.id)}
    {@const isCurrent = currentMatchId === msg.id}
    <div
      data-msg-id={msg.id}
      class={isCurrent ? 'ring-1 ring-yellow-500/60 bg-yellow-500/10' : ''}
    >
      {#if msg.kind === 'user'}
        <UserPromptBlock
          {sessionId}
          text={msg.text}
          files={msg.files}
          images={msg.images}
          onRewind={msg.uuid ? () => messageStore.openRewindDialog(sessionId, msg.uuid) : undefined}
        />

      {:else if msg.kind === 'text'}
        <AssistantTextBlock content={msg.text} />

      {:else if msg.kind === 'tool_call'}
        <ToolCallBlock
          {sessionId}
          toolName={msg.toolName}
          toolInput={msg.toolInput}
          result={msg.result}
          isError={msg.isError}
          pending={msg.pending}
          images={msg.images}
          {summaryMode}
        />

      {:else if msg.kind === 'permission'}
        <PermissionBlock
          {sessionId}
          requestId={msg.requestId}
          toolName={msg.toolName}
          toolInput={msg.toolInput}
          resolved={msg.resolved}
          decision={msg.decision}
          timedOut={msg.timedOut}
          decisionReason={msg.decisionReason}
          isPlanExecution={msg.isPlanExecution}
          toolCategory={msg.toolCategory}
          planText={msg.planText}
        />

      {:else if msg.kind === 'question'}
        <QuestionBlock
          {sessionId}
          requestId={msg.requestId}
          questions={msg.questions}
          resolved={msg.resolved}
          response={msg.response}
          selectedLabels={msg.selectedLabels}
          timedOut={msg.timedOut}
        />

      {:else if msg.kind === 'elicitation'}
        <ElicitationBlock
          {sessionId}
          requestId={msg.requestId}
          request={msg.request}
          resolved={msg.resolved}
          action={msg.action}
        />

      {:else if msg.kind === 'thinking'}
        <ThinkingBlock thinking={msg.thinking} />

      {:else if msg.kind === 'system'}
        <SystemBlock text={msg.text} variant={msg.level === 'warning' ? 'warning' : 'info'} />

      {:else if msg.kind === 'error'}
        <SystemBlock text={msg.text} variant="error" />

      {:else if msg.kind === 'git_identity_missing'}
        <GitIdentityNotice />

      {:else if msg.kind === 'result'}
        <div class="py-1 border-t border-border mt-1">
          <div class="text-xs text-muted-foreground">
            {msg.isError ? 'completed with errors' : 'done'}
            {#if msg.totalCostUsd !== undefined}
              <span class="ml-2">${msg.totalCostUsd.toFixed(4)}</span>
            {/if}
            {#if msg.durationMs !== undefined}
              <span class="ml-2">{(msg.durationMs / 1000).toFixed(1)}s</span>
            {/if}
          </div>
          {#if msg.errors?.length}
            <div class="text-xs text-destructive mt-1">{msg.errors.join(', ')}</div>
          {/if}
        </div>
      {/if}
    </div>

  {/each}

  <!-- Streaming thinking (live) — suppressed in focus mode -->
  {#if streamingThinking && viewMode !== 'focus' && arrival === null}
    {@const trimmed = streamingThinking.trimEnd()}
    {@const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1).trim() || 'thinking...'}
    <div class="py-1 flex items-center gap-2 text-xs text-muted-foreground italic truncate">
      <span class="inline-block w-1.5 h-3 bg-purple-400 animate-pulse shrink-0"></span>
      <span class="truncate">{lastLine}</span>
    </div>
  {/if}

  <!-- Streaming text (live) -->
  {#if streamingText}
    <div class="py-1 text-sm text-foreground">
      {#if paneShown}<MarkdownBlock content={streamingText} streaming />{/if}
      <span class="inline-block w-1.5 h-4 bg-muted-foreground animate-pulse ml-0.5 align-text-bottom"></span>
    </div>
  {:else if arrival !== null}
    <!-- The first turn: the agent walks up to its bench and gets to work.
         Only the open conversation draws it, so it picks up from its start
         time when shown again rather than replaying a stale animation. -->
    <div class="flex-1 flex items-center justify-center py-6">
      {#if store.activeSessionId === sessionId}
        <GroveWalk seed={sessionId} projectColor={sessionRepoColor(sessionId)} spriteState={session ? sessionSpriteState(session) : 'starting'} {arrival}>
          {#snippet caption()}
            <p class="text-sm mt-4 text-muted-foreground">
              {#if session?.status === 'installing'}
                Installing dependencies...
              {:else if session?.status === 'starting' || !isRunning}
                Starting agent...
              {:else}
                {@render activityLabel()}
              {/if}
            </p>
          {/snippet}
        </GroveWalk>
      {/if}
    </div>
  {:else if isRunning && (!streamingThinking || viewMode === 'focus')}
    <div class="py-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span class="inline-block w-2.5 h-2.5 bg-primary animate-fidget"></span>
      {@render activityLabel()}
    </div>
  {/if}

  {#snippet activityLabel()}
    {#if activity.activity === 'thinking'}
      <span class="text-purple-400">Thinking...</span>
    {:else if activity.activity === 'tool_starting'}
      <span class="text-yellow-400">
        Running {activity.toolName ?? 'tool'}{#if activity.toolSummary}&nbsp;<span class="text-muted-foreground">{activity.toolSummary}</span>{/if}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0}&nbsp;({Math.round(activity.elapsedSeconds)}s){/if}
      </span>
    {:else if activity.activity === 'generating'}
      <span class="text-primary">Writing...</span>
    {:else}
      <span>Working...</span>
    {/if}
  {/snippet}

  <div class="h-1"></div>
</div>

{#if !shouldAutoScroll}
  <button
    onclick={scrollToBottom}
    class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-2 py-1 text-xs bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors shadow-md"
    title="Scroll to bottom"
  >
    &darr; Bottom
  </button>
{/if}

<!-- Bookmark text fallback: shown when a jump can't locate the source message -->
{#if fallbackBookmarkText}
  <div class="absolute top-2 left-3 right-16 z-30 bg-card border border-yellow-500/40 shadow-md p-2 text-xs">
    <div class="flex items-center justify-between mb-1">
      <span class="text-yellow-500/90 font-medium">Bookmarked text — source no longer in history</span>
      <button
        onclick={() => fallbackBookmarkText = null}
        class="text-muted-foreground hover:text-foreground px-1"
        title="Dismiss"
      >&times;</button>
    </div>
    <pre class="whitespace-pre-wrap break-words max-h-40 overflow-y-auto text-foreground/90">{fallbackBookmarkText}</pre>
  </div>
{/if}
</div>

<SelectionMenu {sessionId} container={scrollContainer} />
<ActivityContextMenu {sessionId} container={scrollContainer} />
