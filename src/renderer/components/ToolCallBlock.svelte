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
  }: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    result?: string;
    isError?: boolean;
    pending: boolean;
  } = $props();
</script>

{#if toolName === 'Bash'}
  <BashBlock {toolInput} {result} {isError} {pending} />
{:else if toolName === 'Edit' || toolName === 'Write'}
  <DiffBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} />
{:else if toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob'}
  <FileOpBlock {sessionId} {toolName} {toolInput} {result} {pending} {isError} />
{:else}
  <GenericToolBlock {toolName} {toolInput} {result} {pending} {isError} />
{/if}
