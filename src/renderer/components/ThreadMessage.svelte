<script lang="ts">
  /** One message as a thread draws it: the conversation's Thread tab, and a
   *  subagent's panel. */
  import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
  import UserPromptBlock from './UserPromptBlock.svelte';
  import AssistantTextBlock from './AssistantTextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionBlock from './PermissionBlock.svelte';
  import QuestionBlock from './QuestionBlock.svelte';
  import ElicitationBlock from './ElicitationBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import SystemBlock from './SystemBlock.svelte';
  import GitIdentityNotice from './GitIdentityNotice.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';

  let { sessionId, msg, summaryMode }: { sessionId: string; msg: ChatMessage; summaryMode: boolean } = $props();
</script>

{#if msg.kind === 'user'}
  <UserPromptBlock
    {sessionId}
    text={msg.text}
    files={msg.files}
    images={msg.images}
    attachments={msg.attachments}
    onRewind={msg.uuid ? () => messageStore.openRewindDialog(sessionId, msg.uuid) : undefined}
  />

{:else if msg.kind === 'text'}
  <AssistantTextBlock content={msg.text} />

{:else if msg.kind === 'tool_call'}
  <ToolCallBlock
    {sessionId}
    toolUseId={msg.toolUseId}
    toolName={msg.toolName}
    toolInput={msg.toolInput}
    toolView={msg.toolView}
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
    toolView={msg.toolView}
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
  {#if msg.auth}
    <button
      type="button"
      class="ml-4 mt-1 text-xs text-primary hover:underline"
      onclick={() => settingsStore.openAt('agents')}
    >
      Open Settings → Agents
    </button>
  {/if}

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
