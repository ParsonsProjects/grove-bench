<script lang="ts">
  import BashBlock from './BashBlock.svelte';
  import DiffBlock from './DiffBlock.svelte';
  import FileOpBlock from './FileOpBlock.svelte';
  import GenericToolBlock from './GenericToolBlock.svelte';
  import AgentCallBlock from './AgentCallBlock.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import type { StoredImage } from '../../shared/types.js';
  import { toolViewOf, type ToolView } from '../../shared/tool-view.js';

  let {
    sessionId,
    toolUseId,
    toolName,
    toolInput,
    toolView,
    result,
    isError,
    pending,
    images,
    summaryMode = false,
  }: {
    sessionId: string;
    /** The call's id; an Agent call's subagent is found by it. */
    toolUseId?: string;
    toolName: string;
    toolInput: unknown;
    /** The adapter's view of the call; without one it is read as a Claude Code tool. */
    toolView?: ToolView;
    result?: string;
    isError?: boolean;
    pending: boolean;
    /** Images the tool returned (a screenshot, an image file it read). */
    images?: StoredImage[];
    summaryMode?: boolean;
  } = $props();

  let view = $derived(toolViewOf({ toolName, toolInput, toolView }));
</script>

{#if view.kind === 'shell'}
  <BashBlock {toolInput} command={view.command ?? ''} {result} {isError} {pending} {summaryMode} />
{:else if view.kind === 'edit' && (view.edits?.length || view.write !== undefined)}
  <DiffBlock {sessionId} {view} {result} {pending} {isError} {summaryMode} />
{:else if (view.kind === 'read' || view.kind === 'search') && (view.path || view.pattern)}
  <FileOpBlock {sessionId} {toolName} {view} {result} {pending} {isError} />
{:else if view.kind === 'agent' && toolUseId}
  <AgentCallBlock {sessionId} {toolUseId} {toolName} {toolInput} summary={view.summary} {result} {pending} {isError} />
{:else}
  <GenericToolBlock {toolName} {toolInput} summary={toolView?.summary} {result} {pending} {isError} />
{/if}
{#if images?.length}
  <ImageAttachments {sessionId} {images} class="pl-4 mb-1" />
{/if}
