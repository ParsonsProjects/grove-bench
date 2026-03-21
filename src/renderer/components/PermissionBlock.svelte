<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import DiffView, { computeDiffLines } from './DiffView.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';

  let {
    sessionId,
    requestId,
    toolName,
    toolInput,
    resolved,
    decision,
    decisionReason,
    suggestions,
  }: {
    sessionId: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
    resolved: boolean;
    decision?: 'allow' | 'deny';
    decisionReason?: string;
    suggestions?: unknown[];
  } = $props();

  let expanded = $state(false);
  let sideBySide = $state(false);
  let replyText = $state('');
  let submitting = $state(false);
  /** Instant visual feedback while waiting for the authoritative
   *  permission_resolved event from main. Purely cosmetic. */
  let pendingDecision = $state<'allow' | 'deny' | null>(null);

  let input = $derived(toolInput as Record<string, unknown>);
  let isEditTool = $derived(toolName === 'Edit' || toolName === 'Write');
  let isBashTool = $derived(toolName === 'Bash');
  let isExitPlanMode = $derived(toolName === 'ExitPlanMode');
  let isWebFetch = $derived(toolName === 'WebFetch' || toolName === 'mcp__WebFetch' || (typeof input?.url === 'string'));
  let filePath = $derived(isEditTool ? String(input?.file_path ?? input?.filePath ?? '') : '');
  let bashCommand = $derived(isBashTool ? String(input?.command ?? '') : '');
  let fetchUrl = $derived(isWebFetch ? String(input?.url ?? '') : '');
  let diffLines = $derived(isEditTool ? computeDiffLines(toolName, input, filePath) : []);

  async function approve() {
    if (submitting) return;
    submitting = true;
    pendingDecision = 'allow';
    try {
      await messageStore.resolvePermission(sessionId, requestId, 'allow');
    } catch (e) {
      console.error('[PermissionBlock] approve failed:', e);
      submitting = false;
      pendingDecision = null;
    }
  }

  async function approveAlways() {
    if (submitting) return;
    submitting = true;
    pendingDecision = 'allow';
    try {
      await messageStore.resolvePermission(sessionId, requestId, 'allowAlways');
    } catch (e) {
      console.error('[PermissionBlock] approveAlways failed:', e);
      submitting = false;
      pendingDecision = null;
    }
  }

  /** Execute and clear — allow with SDK suggestions to exit plan mode */
  async function approveAndClear() {
    if (submitting) return;
    submitting = true;
    pendingDecision = 'allow';
    try {
      await messageStore.resolvePermission(sessionId, requestId, 'allow', {
        updatedPermissions: suggestions,
      });
    } catch (e) {
      console.error('[PermissionBlock] approveAndClear failed:', e);
      submitting = false;
      pendingDecision = null;
    }
  }

  /** Clear the conversation and re-send the plan as a fresh prompt */
  async function clearAndExecute() {
    if (!planText || submitting) return;
    submitting = true;
    pendingDecision = 'deny';
    try {
      const prompt = `Execute the following plan:\n\n${planText}`;
      await messageStore.resolvePermission(sessionId, requestId, 'deny', { message: 'Clearing and restarting with the plan.' });
      messageStore.clearAndSend(sessionId, prompt);
    } catch (e) {
      console.error('[PermissionBlock] clearAndExecute failed:', e);
      submitting = false;
      pendingDecision = null;
    }
  }

  async function deny(message?: string) {
    if (submitting) return;
    submitting = true;
    pendingDecision = 'deny';
    try {
      await messageStore.resolvePermission(sessionId, requestId, 'deny', { message });
    } catch (e) {
      console.error('[PermissionBlock] deny failed:', e);
      submitting = false;
      pendingDecision = null;
    }
  }

  async function sendReply() {
    const text = replyText.trim();
    if (!text) return;
    await deny(text);
    replyText = '';
  }

  function handleReplyKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  function openInEditor() {
    if (filePath) {
      window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
    }
  }

  function formatInput(inp: unknown): string {
    if (typeof inp === 'string') return inp;
    try { return JSON.stringify(inp, null, 2); }
    catch { return String(inp); }
  }

  function summarizeInput(inp: unknown): string {
    if (typeof inp !== 'object' || inp === null) return '';
    const obj = inp as Record<string, unknown>;
    if (obj.file_path) return String(obj.file_path);
    if (obj.command) return String(obj.command).slice(0, 80);
    return '';
  }

  // For ExitPlanMode, collect the plan text from preceding assistant messages
  let planText = $derived.by(() => {
    if (!isExitPlanMode) return '';
    const msgs = messageStore.getMessages(sessionId);
    const parts: string[] = [];
    // Walk backwards from the end to find this permission, then collect text between EnterPlanMode and here
    let foundSelf = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!foundSelf) {
        if (m.kind === 'permission' && m.requestId === requestId) foundSelf = true;
        continue;
      }
      if (m.kind === 'tool_call' && m.toolName === 'EnterPlanMode') break;
      if (m.kind === 'text') parts.unshift(m.text);
    }
    return parts.join('\n\n');
  });

  // Resolved once the authoritative event arrives, or optimistically while waiting
  let isResolved = $derived(resolved || pendingDecision !== null);
  // Prefer the authoritative decision from the store, fall back to what we clicked
  let effectiveDecision = $derived(decision ?? pendingDecision);

  let borderColor = $derived(
    isResolved
      ? (effectiveDecision === 'allow' ? 'border-green-400' : 'border-destructive')
      : 'border-amber-500'
  );

  let labelColor = $derived(
    isResolved
      ? (effectiveDecision === 'allow' ? 'text-green-400' : 'text-destructive')
      : 'text-amber-500'
  );
</script>

<div class="py-1 my-1 border-l-4 {borderColor} pl-3">
  <div class="flex items-center gap-2 text-xs">
    <span class="{labelColor} font-bold">{isExitPlanMode ? 'plan ready' : 'permission'}</span>
    <span class="text-foreground">{isExitPlanMode ? 'Claude wants to execute the plan' : toolName}</span>
    {#if filePath}
      <button
        onclick={openInEditor}
        class="text-muted-foreground hover:text-primary hover:underline cursor-pointer truncate flex-1 text-left"
        title="Open in editor"
      >{filePath}</button>
    {:else if !isBashTool}
      <span class="text-muted-foreground truncate flex-1">{summarizeInput(toolInput)}</span>
    {/if}
    {#if !isResolved && isEditTool && diffLines.length > 0 && toolName === 'Edit'}
      <button
        onclick={() => sideBySide = !sideBySide}
        class="text-xs text-muted-foreground hover:text-foreground select-none shrink-0"
      >
        {sideBySide ? 'unified' : 'side-by-side'}
      </button>
    {/if}
  </div>

  {#if decisionReason}
    <div class="text-xs text-muted-foreground mt-1">{decisionReason}</div>
  {/if}

  <!-- Command preview for Bash -->
  {#if isBashTool && bashCommand}
    <pre class="text-xs text-foreground bg-card/80 border border-border px-3 py-2 mt-1 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap break-all">{bashCommand}</pre>
  {/if}

  <!-- URL preview for WebFetch -->
  {#if isWebFetch && fetchUrl}
    <div class="text-xs text-blue-400 font-mono mt-1 truncate" title={fetchUrl}>{fetchUrl}</div>
  {/if}

  <!-- Inline diff preview for Edit/Write (only while awaiting approval) -->
  {#if !isResolved && isEditTool && diffLines.length > 0}
    <div class="mt-1">
      <DiffView lines={diffLines} {sideBySide} maxHeight="200px" />
    </div>
  {/if}

  {#if isExitPlanMode && planText}
    <button
      onclick={() => expanded = !expanded}
      class="text-xs text-muted-foreground hover:text-foreground mt-1"
    >
      {expanded ? 'hide' : 'show'} plan
    </button>

    {#if expanded}
      <div class="mt-1 text-sm text-foreground bg-card/50 border border-border p-3 max-h-64 overflow-y-auto">
        <MarkdownBlock content={planText} />
      </div>
    {/if}
  {:else if !isEditTool && !isBashTool && !isExitPlanMode}
    <button
      onclick={() => expanded = !expanded}
      class="text-xs text-muted-foreground hover:text-foreground mt-1"
    >
      {expanded ? 'hide' : 'show'} details
    </button>

    {#if expanded}
      <pre class="text-xs text-muted-foreground bg-card p-2 overflow-x-auto max-h-40 overflow-y-auto mt-1">{formatInput(toolInput)}</pre>
    {/if}
  {/if}

  {#if isResolved}
    <div class="text-xs mt-1 {effectiveDecision === 'allow' ? 'text-green-400' : 'text-destructive'}">
      {#if isExitPlanMode}
        {effectiveDecision === 'allow' ? 'plan executed' : 'kept planning'}
      {:else}
        {effectiveDecision === 'allow' ? 'allowed' : 'denied'}
      {/if}
    </div>
  {:else}
    {#if isExitPlanMode}
      <div class="flex gap-2 mt-2 flex-wrap">
        {#if suggestions && suggestions.length > 0}
          <Button variant="outline" size="sm" onclick={approveAndClear} disabled={submitting} class="text-green-400 border-green-600 hover:bg-green-900/30">
            Execute and clear
          </Button>
        {/if}
        <Button variant="outline" size="sm" onclick={approve} disabled={submitting} class="text-green-400 border-green-600 hover:bg-green-900/30">
          Execute
        </Button>
        <Button variant="outline" size="sm" onclick={() => deny()} disabled={submitting} class="text-destructive border-destructive hover:bg-destructive/10">
          No
        </Button>
        {#if planText}
          <Button variant="outline" size="sm" onclick={clearAndExecute} disabled={submitting} class="text-blue-400 border-blue-600 hover:bg-blue-900/30">
            Clear &amp; Execute
          </Button>
        {/if}
      </div>
      <div class="flex gap-2 mt-2 items-center">
        <input
          type="text"
          bind:value={replyText}
          onkeydown={handleReplyKeydown}
          placeholder="Reply to continue planning..."
          class="flex-1 text-xs bg-card border border-border px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
        />
        <Button
          variant="outline"
          size="sm"
          onclick={sendReply}
          disabled={!replyText.trim()}
          class="text-primary border-primary hover:bg-primary/10 disabled:text-muted-foreground disabled:border-border shrink-0"
        >
          Send
        </Button>
      </div>
    {:else}
      <div class="flex gap-2 mt-2">
        <Button variant="outline" size="sm" onclick={approve} disabled={submitting} class="text-green-400 border-green-600 hover:bg-green-900/30">
          Allow
        </Button>
        <Button variant="outline" size="sm" onclick={approveAlways} disabled={submitting} class="text-green-400 border-green-600 hover:bg-green-900/30">
          Always Allow
        </Button>
        <Button variant="outline" size="sm" onclick={() => deny()} disabled={submitting} class="text-destructive border-destructive hover:bg-destructive/10">
          Deny
        </Button>
      </div>
    {/if}
  {/if}
</div>
