<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import DiffView from './DiffView.svelte';
  import { fullEditDiff, quickEditDiff } from '../lib/edit-diff.js';
  import LargeDiffNotice from './LargeDiffNotice.svelte';
  import OldThenNewNotice from './OldThenNewNotice.svelte';
  import { editSize } from '../lib/diff-highlight.js';
  import { toolLabel } from '$lib/tool-names.js';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import AgentSprite from './AgentSprite.svelte';
  import { sessionRepoColor } from '../lib/session-repo-color.js';
  import { alwaysAllowLabel } from '../lib/always-allow.js';
  import { PERMISSION_TIMEOUT_MINUTES, PLAN_RESTART_MESSAGE } from '../../shared/types.js';
  import { toolViewOf, toolViewSummary, type ToolView } from '../../shared/tool-view.js';

  let {
    sessionId,
    requestId,
    toolName,
    toolInput,
    resolved,
    decision,
    timedOut = false,
    decisionReason,
    isPlanExecution = false,
    toolCategory,
    toolView,
    planText: planTextProp,
  }: {
    sessionId: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
    resolved: boolean;
    decision?: 'allow' | 'deny';
    /** Denied because nobody answered in time. */
    timedOut?: boolean;
    decisionReason?: string;
    isPlanExecution?: boolean;
    toolCategory?: import('../../shared/types.js').ToolCategory;
    /** The adapter's view of the call; without one it is read as a Claude Code tool. */
    toolView?: ToolView;
    planText?: string;
  } = $props();

  let expanded = $state(false);
  let sideBySide = $state(false);
  let replyText = $state('');
  let submitting = $state(false);
  /** Instant visual feedback while waiting for the authoritative
   *  permission_resolved event from main. Purely cosmetic. */
  let pendingDecision = $state<'allow' | 'deny' | null>(null);

  let input = $derived(toolInput as Record<string, unknown>);
  let view = $derived(toolViewOf({ toolName, toolInput, toolView }));
  /** File edits Grove can show as a diff (other edits, such as a notebook
   *  cell, show their raw input). */
  let isEditTool = $derived(toolCategory === 'edit' || (view.kind === 'edit' && (!!view.edits?.length || view.write !== undefined)));
  let isBashTool = $derived(toolCategory === 'bash' || view.kind === 'shell');
  let isExitPlanMode = $derived(isPlanExecution);
  let isWebFetch = $derived(toolCategory === 'web_fetch' || view.kind === 'fetch' || (typeof input?.url === 'string'));
  let filePath = $derived(isEditTool ? (view.path ?? '') : '');
  let bashCommand = $derived(isBashTool ? (view.command ?? String(input?.command ?? '')) : '');
  /** A command the agent only titled (it sent no command text, as Gemini CLI
   *  does): shown as its own description, not as the command. */
  let describedCommand = $derived(isBashTool && !bashCommand ? (view.summary ?? '') : '');
  let fetchUrl = $derived(isWebFetch ? (view.url ?? String(input?.url ?? '')) : '');
  /** A large edit waits for "Show edit", as in the thread (quickEditDiff);
   *  the decision buttons work either way. */
  let quickDiff = $derived(isEditTool ? quickEditDiff(view, filePath) : null);
  let editShown = $state(false);
  let editHeldBack = $derived(!!quickDiff?.large && !editShown);
  /** "Compare line by line" was clicked: work it out in full. */
  let editCompared = $state(false);
  let shownDiff = $derived(!quickDiff || editHeldBack ? null : fullEditDiff(view, filePath, editCompared ? null : quickDiff.diff));
  let diffLines = $derived(shownDiff?.lines ?? []);
  let alwaysAllow = $derived(alwaysAllowLabel(toolName, toolCategory));
  /** What a call other than an edit or command is about, from the view, so
   *  any agent's reads, searches and fetches name their target. */
  let viewTarget = $derived(toolViewSummary(view));
  /** "Approve and start fresh…" clears the conversation, so it asks first. */
  let confirmFresh = $state(false);

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

  /** Clear the conversation and re-send the plan as a fresh prompt */
  async function clearAndExecute() {
    if (!planText || submitting) return;
    submitting = true;
    pendingDecision = 'deny';
    try {
      const prompt = `Execute the following plan:\n\n${planText}`;
      await messageStore.resolvePermission(sessionId, requestId, 'deny', { message: PLAN_RESTART_MESSAGE });
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

  // For plan execution permissions, use the plan text provided by the adapter.
  // Fallback: walk backwards from this permission to collect preceding assistant text.
  let planText = $derived.by(() => {
    if (!isExitPlanMode) return '';

    // Primary: adapter extracted the plan text
    if (planTextProp) return planTextProp;

    // Fallback: walk backwards to collect assistant text before this permission
    const msgs = messageStore.getMessages(sessionId);
    const parts: string[] = [];
    let foundSelf = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!foundSelf) {
        if (m.kind === 'permission' && m.requestId === requestId) foundSelf = true;
        continue;
      }
      if (m.kind === 'tool_call' && (m as any).isPlanExecution) break;
      if (m.kind === 'permission') break;
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
      : 'border-status-attention'
  );

  // Grove character: waits with a "?" until answered, then sits still with the outcome.
  let spriteState = $derived<'permission' | 'allowed' | 'denied'>(
    isResolved ? (effectiveDecision === 'allow' ? 'allowed' : 'denied') : 'permission'
  );

  let labelColor = $derived(
    isResolved
      ? (effectiveDecision === 'allow' ? 'text-green-400' : 'text-destructive')
      : 'text-status-attention'
  );
</script>

<div class="py-1 my-1 border-l-4 {borderColor} pl-3">
  <div class="flex items-center gap-2 text-xs">
    {#if settingsStore.current.groveCharacters}
      <AgentSprite state={spriteState} seed={sessionId} projectColor={sessionRepoColor(sessionId)} scale={isResolved ? 2 : 3} />
    {/if}
    <span class="{labelColor} font-bold">{isExitPlanMode ? 'plan ready' : 'permission'}</span>
    <span class="text-foreground">{isExitPlanMode ? 'Agent wants to execute the plan' : toolLabel(toolName)}</span>
    {#if isExitPlanMode && planText}
      <Button
        variant="subtle"
        size="2xs"
        onclick={() => markdownPreviewStore.show(planText, 'Proposed plan', sessionId)}
        title="Read the plan full-width"
      >
        <svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        Focus
      </Button>
    {/if}
    {#if filePath}
      <button
        onclick={openInEditor}
        class="text-muted-foreground hover:text-primary hover:underline cursor-pointer truncate flex-1 text-left"
        title="Open in editor"
      >{filePath}</button>
    {:else if !isBashTool}
      <span class="text-muted-foreground truncate flex-1">{viewTarget || summarizeInput(toolInput)}</span>
    {/if}
    {#if !isResolved && isEditTool && diffLines.length > 0 && !!view.edits?.length}
      <Button
        variant="quiet"
        size="inline"
        onclick={() => sideBySide = !sideBySide}
        class="select-none"
      >
        {sideBySide ? 'unified' : 'side-by-side'}
      </Button>
    {/if}
  </div>

  {#if decisionReason}
    <div class="text-xs text-muted-foreground mt-1">{decisionReason}</div>
  {/if}

  <!-- Command preview for Bash -->
  {#if isBashTool && bashCommand}
    <pre class="text-xs text-foreground bg-card/80 border border-border px-3 py-2 mt-1 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap break-all">{bashCommand}</pre>
  {:else if describedCommand}
    <pre class="text-xs text-foreground bg-card/80 border border-border px-3 py-2 mt-1 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap break-all">{describedCommand}</pre>
    <div class="text-caption text-muted-foreground mt-0.5">As the agent describes it. It didn't send the exact command.</div>
  {/if}

  <!-- URL preview for WebFetch -->
  {#if isWebFetch && fetchUrl}
    <div class="text-xs text-blue-400 font-mono mt-1 truncate" title={fetchUrl}>{fetchUrl}</div>
  {/if}

  <!-- Inline diff preview for Edit/Write (only while awaiting approval) -->
  {#if !isResolved && editHeldBack}
    <div class="mt-1">
      <LargeDiffNotice kind="edit" size={editSize(view)} label={filePath ? `Show edit to ${filePath}` : 'Show edit'} onShow={() => (editShown = true)} />
    </div>
  {:else if !isResolved && isEditTool && diffLines.length > 0}
    <div class="mt-1">
      {#if shownDiff && !shownDiff.linedUp}<OldThenNewNotice diff={shownDiff} label={filePath ? `Compare edit to ${filePath} line by line` : undefined} onCompare={() => (editCompared = true)} />{/if}
      <DiffView lines={diffLines} {sideBySide} maxHeight="200px" {filePath} deferHighlight />
    </div>
  {/if}

  {#if isExitPlanMode && planText}
    <Button
      variant="quiet"
      size="inline"
      onclick={() => expanded = !expanded}
      class="text-xs mt-1"
    >
      {expanded ? 'hide' : 'show'} plan
    </Button>

    {#if expanded}
      <div class="mt-1 text-sm text-foreground bg-card/50 border border-border p-3 max-h-64 overflow-y-auto">
        <MarkdownBlock content={planText} {sessionId} />
      </div>
    {/if}
  {:else if !isEditTool && !isBashTool && !isExitPlanMode}
    <Button
      variant="quiet"
      size="inline"
      onclick={() => expanded = !expanded}
      class="text-xs mt-1"
    >
      {expanded ? 'hide' : 'show'} details
    </Button>

    {#if expanded}
      <pre class="text-xs text-muted-foreground bg-card p-2 overflow-x-auto max-h-40 overflow-y-auto mt-1">{formatInput(toolInput)}</pre>
    {/if}
  {/if}

  {#if isResolved}
    <div class="text-xs mt-1 {effectiveDecision === 'allow' ? 'text-green-400' : 'text-destructive'}">
      {#if timedOut}
        <span class="text-muted-foreground">no answer after {PERMISSION_TIMEOUT_MINUTES} minutes, so it was denied</span>
      {:else if isExitPlanMode}
        {effectiveDecision === 'allow' ? 'plan approved' : 'kept planning'}
      {:else}
        {effectiveDecision === 'allow' ? 'allowed' : 'denied'}
      {/if}
    </div>
  {:else}
    {#if isExitPlanMode}
      <div class="flex gap-2 mt-2 flex-wrap">
        {#if confirmFresh}
          <p class="basis-full text-xs text-foreground" role="alert">
            Clear this thread's messages and start again with only the plan? Your files stay as they are.
          </p>
          <Button variant="subtle" size="sm" onclick={() => confirmFresh = false} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="outline-success" size="sm" onclick={clearAndExecute} disabled={submitting}>
            Clear and start
          </Button>
        {:else}
          <!-- Approving always switches to Edit mode (messageStore.resolvePermission). -->
          <Button variant="outline-success" size="sm" onclick={approve} disabled={submitting} title="Approve the plan. The thread switches to Edit mode so the plan's file edits don't each ask; commands still ask.">
            Approve
          </Button>
          {#if planText}
            <Button variant="subtle" size="sm" onclick={() => confirmFresh = true} disabled={submitting} title="Clear this thread's messages and send the plan as a new first message, so the agent starts with a clean context. Asks first.">
              Approve and start fresh…
            </Button>
          {/if}
          <Button variant="outline-destructive" size="sm" onclick={() => deny()} disabled={submitting} title="Don't start yet. Type below to say what to change in the plan.">
            Keep planning
          </Button>
        {/if}
      </div>
      <div class="flex gap-2 mt-2 items-center">
        <input
          type="text"
          bind:value={replyText}
          onkeydown={handleReplyKeydown}
          placeholder="Reply to continue planning..."
          class="flex-1 text-xs bg-card border border-border h-8 px-2 py-1 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <Button
          variant="subtle"
          size="icon-sm"
          onclick={sendReply}
          disabled={!replyText.trim()}
          title="Send (Enter)"
          aria-label="Send"
        >
          <ArrowUpIcon />
        </Button>
      </div>
    {:else}
      <div class="flex gap-2 mt-2">
        <Button variant="outline-success" size="sm" onclick={approve} disabled={submitting}>
          Allow
        </Button>
        <Button variant="outline-success" size="sm" onclick={approveAlways} disabled={submitting} title={alwaysAllow.title}>
          {alwaysAllow.label}
        </Button>
        <Button variant="outline-destructive" size="sm" onclick={() => deny()} disabled={submitting}>
          Deny
        </Button>
      </div>
    {/if}
  {/if}
</div>
