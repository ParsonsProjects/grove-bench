<script lang="ts">
  /**
   * A call that started a subagent: one line in every thread view, saying
   * how far it has got. Clicking it opens the subagent's own thread in a
   * slide-out (SubagentPanel).
   */
  import { messageStore } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { agentCallInput, threadMessages } from '../lib/message-view.js';

  let {
    sessionId,
    toolUseId,
    toolName,
    toolInput,
    summary,
    result,
    pending,
    isError,
  }: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    toolInput: unknown;
    /** The task the subagent was given, in a line. */
    summary?: string;
    result?: string;
    pending: boolean;
    isError?: boolean;
  } = $props();

  let thread = $derived(threadMessages(messageStore.getMessages(sessionId), toolUseId));
  let callCount = $derived(thread.reduce((n, m) => n + (m.kind === 'tool_call' ? 1 : 0), 0));
  // A background subagent's call returns at once; its task says it's still at work.
  let running = $derived(pending || backgroundTaskStore.isRunningFor(sessionId, toolUseId));
  let agentType = $derived(agentCallInput(toolInput).agentType);
  let showing = $derived(subagentPanelStore.isShowing(sessionId, toolUseId));
</script>

<div class="py-1 my-1 border-l-4 pl-3 {showing ? 'border-primary' : 'border-primary/40'}">
  <button
    onclick={() => subagentPanelStore.show(sessionId, toolUseId)}
    class="w-full flex items-center gap-2 text-left text-xs hover:bg-accent/30 -ml-1 pl-1 py-0.5"
    title="Open this subagent's thread"
  >
    <span class="text-muted-foreground font-bold">{toolName}</span>
    {#if agentType}
      <span class="text-muted-foreground shrink-0">{agentType}</span>
    {/if}
    <span class="text-muted-foreground/70 truncate flex-1">{summary ?? ''}</span>
    {#if callCount > 0}
      <span class="text-muted-foreground/70 shrink-0">{callCount} {callCount === 1 ? 'call' : 'calls'}</span>
    {/if}
    {#if running}
      <span class="w-2.5 h-2.5 bg-primary animate-pulse shrink-0"></span>
      <span class="sr-only">running</span>
    {:else if isError}
      <span class="text-destructive">error</span>
    {:else if result !== undefined}
      <span class="text-muted-foreground">done</span>
    {/if}
    <span class="text-muted-foreground/40">&rsaquo;</span>
  </button>
</div>
