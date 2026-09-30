<script lang="ts">
  import BashBlock from './BashBlock.svelte';
  import DiffBlock from './DiffBlock.svelte';
  import FileOpBlock from './FileOpBlock.svelte';
  import GenericToolBlock from './GenericToolBlock.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import type { StoredImage } from '../../shared/types.js';

  let {
    sessionId,
    toolName,
    toolInput,
    result,
    isError,
    pending,
    images,
    summaryMode = false,
  }: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    result?: string;
    isError?: boolean;
    pending: boolean;
    /** Images the tool returned (a screenshot, an image file it read). */
    images?: StoredImage[];
    summaryMode?: boolean;
  } = $props();
</script>

{#if toolName === 'Bash'}
  <BashBlock {toolInput} {result} {isError} {pending} {summaryMode} />
{:else if toolName === 'Edit' || toolName === 'Write'}
  <DiffBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} {summaryMode} />
{:else if toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob'}
  <FileOpBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} />
{:else}
  <GenericToolBlock {toolName} {toolInput} {result} {pending} {isError} />
{/if}
{#if images?.length}
  <ImageAttachments {sessionId} {images} class="pl-4 mb-1" />
{/if}
