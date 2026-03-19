<script lang="ts">
  import BashBlock from './BashBlock.svelte';
  import DiffBlock from './DiffBlock.svelte';
  import FileOpBlock from './FileOpBlock.svelte';
  import GenericToolBlock from './GenericToolBlock.svelte';

  let {
    sessionId,
    toolName,
    toolInput,
    result,
    isError,
    pending,
    summaryMode = false,
  }: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    result?: string;
    isError?: boolean;
    pending: boolean;
    summaryMode?: boolean;
  } = $props();
</script>

{#if toolName === 'Bash'}
  <BashBlock {toolInput} {result} {isError} {pending} />
{:else if toolName === 'Edit' || toolName === 'Write'}
  <DiffBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} {summaryMode} />
{:else if toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob'}
  <FileOpBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} />
{:else}
  <GenericToolBlock {toolName} {toolInput} {result} {pending} {isError} />
{/if}
