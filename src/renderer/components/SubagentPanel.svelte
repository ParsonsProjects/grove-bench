<script lang="ts">
  /**
   * A subagent's own thread in a slide-out, like the Focus panel: what it was
   * asked, its notes, tool calls and report, with its own view picker. Opened
   * from its Agent call (AgentCallBlock); one instance, mounted in App.
   */
  import { fly, fade } from 'svelte/transition';
  import { messageStore, type ChatMessage, type ChatToolCallMessage } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { agentCallInput, filterVisibleMessages, threadMessages } from '../lib/message-view.js';
  import { toolViewOf } from '../../shared/tool-view.js';
  import ThreadMessage from './ThreadMessage.svelte';
  import ThreadViewSelect from './ThreadViewSelect.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';

  let sessionId = $derived(subagentPanelStore.sessionId);
  let toolUseId = $derived(subagentPanelStore.toolUseId);
  let all = $derived(messageStore.getMessages(sessionId));
  let call = $derived(all.find((m: ChatMessage): m is ChatToolCallMessage => m.kind === 'tool_call' && m.toolUseId === toolUseId));
  let thread = $derived(threadMessages(all, toolUseId));
  let viewMode = $derived(subagentPanelStore.viewMode(sessionId));
  let visible = $derived(filterVisibleMessages(thread, viewMode));

  let input = $derived(agentCallInput(call?.toolInput));
  let title = $derived((call && toolViewOf(call).summary) || 'Subagent');
  let callCount = $derived(thread.reduce((n, m) => n + (m.kind === 'tool_call' ? 1 : 0), 0));
  let running = $derived(!!call?.pending || backgroundTaskStore.isRunningFor(sessionId, toolUseId));
  let status = $derived(running ? 'running' : call?.isError ? 'error' : 'done');

  // Nothing to show once its call is gone (rewound away, cleared) or another
  // conversation is open.
  $effect(() => {
    if (subagentPanelStore.open && (!call || store.activeSessionId !== sessionId)) subagentPanelStore.close();
  });

  let promptOpen = $state(false);
  let scroller = $state<HTMLDivElement>();
  let follow = true;
  let shownId = '';

  // Open at the latest (the report, when it's done) and follow what arrives,
  // unless scrolled up to read.
  $effect(() => {
    const id = toolUseId;
    void visible.length;
    if (id !== shownId) {
      shownId = id;
      follow = true;
      promptOpen = false;
    }
    const el = scroller;
    if (follow && el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  });

  function handleScroll() {
    if (!scroller) return;
    follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  // Esc closes the panel, unless something over it takes the key: a dialog
  // or menu (bits-ui marks it handled), or the Focus panel, whose own Esc
  // handler has closed it by the time this one runs, so ask first.
  let focusPanelWasOpen = false;
  function noteFocusPanel(e: KeyboardEvent) {
    if (e.key === 'Escape') focusPanelWasOpen = markdownPreviewStore.open;
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !subagentPanelStore.open || focusPanelWasOpen || e.defaultPrevented) return;
    subagentPanelStore.close();
  }
</script>

<svelte:window onkeydowncapture={noteFocusPanel} onkeydown={handleKeydown} />

{#if subagentPanelStore.open && call}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40 bg-black/40"
    transition:fade={{ duration: 150 }}
    onclick={() => subagentPanelStore.close()}
  ></div>
  <aside
    class="fixed top-0 right-0 z-50 h-full w-[720px] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col"
    transition:fly={{ x: 400, duration: 200 }}
    aria-label="Subagent thread"
  >
    <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
      {#if call.parentToolUseId}
        {@const parentId = call.parentToolUseId}
        <button
          onclick={() => subagentPanelStore.show(sessionId, parentId)}
          class="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          title="Back to the subagent that started this one"
          aria-label="Back"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </button>
      {/if}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-foreground truncate" title={title}>{title}</div>
        <div class="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>Subagent{input.agentType ? ` · ${input.agentType}` : ''}</span>
          <span class="text-muted-foreground/40" aria-hidden="true">·</span>
          {#if running}
            <span class="inline-block w-2 h-2 bg-primary animate-pulse"></span>
          {/if}
          <span class={status === 'error' ? 'text-destructive' : ''}>{status}</span>
          {#if callCount > 0}
            <span class="text-muted-foreground/40" aria-hidden="true">·</span>
            <span>{callCount} {callCount === 1 ? 'call' : 'calls'}</span>
          {/if}
        </div>
      </div>
      <ThreadViewSelect {sessionId} subagentOf={toolUseId} />
      <button
        onclick={() => subagentPanelStore.close()}
        class="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        title="Close (Esc)"
        aria-label="Close subagent thread"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3" bind:this={scroller} onscroll={handleScroll}>
      {#if input.prompt}
        <div class="mb-2 border-l-4 border-border pl-3">
          <button
            onclick={() => promptOpen = !promptOpen}
            class="w-full flex items-center gap-2 text-left text-xs hover:bg-accent/30 -ml-1 pl-1 py-0.5"
            aria-expanded={promptOpen}
          >
            <span class="text-muted-foreground font-bold">Prompt</span>
            {#if !promptOpen}
              <span class="text-muted-foreground/70 truncate flex-1">{input.prompt}</span>
            {:else}
              <span class="flex-1"></span>
            {/if}
            <span class="text-muted-foreground/40 transition-transform {promptOpen ? 'rotate-90' : ''}">&rsaquo;</span>
          </button>
          {#if promptOpen}
            <div class="mt-1 text-sm"><MarkdownBlock content={input.prompt} /></div>
          {/if}
        </div>
      {/if}

      {#each visible as msg (msg.id)}
        <ThreadMessage {sessionId} {msg} summaryMode={viewMode !== 'detailed'} />
      {/each}

      {#if running}
        <div class="py-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span class="inline-block w-2.5 h-2.5 bg-primary animate-fidget"></span>
          <span>Working...</span>
        </div>
      {:else if thread.length === 0}
        <!-- Recorded before Grove kept subagents' threads, or it said nothing. -->
        {#if call.result}
          <div class="text-xs text-muted-foreground mb-1">Result</div>
          <div class="text-sm"><MarkdownBlock content={call.result} /></div>
        {:else}
          <p class="text-xs text-muted-foreground">Nothing was recorded for this subagent.</p>
        {/if}
      {/if}
    </div>
  </aside>
{/if}
