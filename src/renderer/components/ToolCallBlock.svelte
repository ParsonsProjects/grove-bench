<script lang="ts">
  import BashBlock from './BashBlock.svelte';
  import DiffBlock from './DiffBlock.svelte';
  import FileOpBlock from './FileOpBlock.svelte';
  import GenericToolBlock from './GenericToolBlock.svelte';
  import AgentCallBlock from './AgentCallBlock.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import type { StoredImage } from '../../shared/types.js';
  import { toolViewOf, type ToolView } from '../../shared/tool-view.js';
  import { worktreeImageType } from '../../shared/attachments.js';

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
    headless = false,
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
    /** Only the body (output, diff, input): a turn card's step line already
     *  says what the call is (TurnStep). */
    headless?: boolean;
  } = $props();

  let view = $derived(toolViewOf({ toolName, toolInput, toolView }));
  // An image file the call wrote or edited (an SVG, mostly: Write writes
  // text), as it is in the worktree now. Not one it deleted or moved; and
  // left out if it won't load (gone since, or outside the worktree).
  let writtenImage = $derived(
    view.kind === 'edit' && view.path && (view.write !== undefined || view.edits?.length) && !pending && !isError
      && worktreeImageType(view.path)
      ? { name: view.path, path: view.path }
      : null,
  );
</script>

{#if view.kind === 'shell'}
  <BashBlock {toolInput} command={view.command ?? ''} {result} {isError} {pending} {summaryMode} {headless} />
{:else if view.kind === 'edit' && (view.edits?.length || view.write !== undefined)}
  <DiffBlock {sessionId} {view} {result} {pending} {isError} {summaryMode} {headless} />
{:else if (view.kind === 'read' || view.kind === 'search') && (view.path || view.pattern)}
  <FileOpBlock {sessionId} {toolName} {view} {result} {pending} {isError} {headless} />
{:else if view.kind === 'agent' && toolUseId}
  <AgentCallBlock {sessionId} {toolUseId} {toolName} summary={view.summary} agentType={view.agentType} {result} {pending} {isError} />
{:else}
  <GenericToolBlock {toolName} {toolInput} summary={toolView?.summary} {result} {pending} {isError} {headless} />
{/if}
{#if images?.length}
  <ImageAttachments {sessionId} {images} class="pl-4 mb-1" />
{/if}
{#if writtenImage}
  <ImageAttachments {sessionId} images={[writtenImage]} hideUnavailable class="pl-4 mb-1" />
{/if}
