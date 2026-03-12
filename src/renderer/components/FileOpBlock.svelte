<script lang="ts">
  import CopyButton from './CopyButton.svelte';

  let {
    sessionId,
    toolName,
    toolInput,
    result,
    pending,
    isError,
  }: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    result?: string;
    pending: boolean;
    isError?: boolean;
  } = $props();

  function openInEditor() {
    if (toolName === 'Read' && filePath) {
      window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
    }
  }

  let collapsed = $state(true);
  let input = $derived(toolInput as Record<string, unknown>);

  let filePath = $derived(String(input?.file_path ?? input?.pattern ?? input?.path ?? ''));

  let summary = $derived.by(() => {
    if (toolName === 'Read') return filePath;
    if (toolName === 'Grep') return `grep: ${input?.pattern ?? ''}`;
    if (toolName === 'Glob') return `glob: ${input?.pattern ?? ''}`;
    return filePath;
  });

  let resultLines = $derived(result ? result.split('\n') : []);
  let isLong = $derived(resultLines.length > 15);
</script>

<div class="py-1 my-1 border-l-4 border-border pl-3">
  <div class="flex items-center gap-2 text-xs group/fop-hdr">
    <span class="text-muted-foreground font-bold">{toolName}</span>
    {#if toolName === 'Read' && filePath}
      <button
        onclick={openInEditor}
        class="text-foreground/80 truncate flex-1 text-left hover:text-primary hover:underline cursor-pointer"
        title="Open in editor"
      >{summary}</button>
    {:else}
      <span class="text-foreground/80 truncate flex-1">{summary}</span>
    {/if}
    {#if filePath}
      <CopyButton text={filePath} class="opacity-0 group-hover/fop-hdr:opacity-100 shrink-0" />
    {/if}
    {#if pending}
      <span class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></span>
    {:else if isError}
      <span class="text-destructive">error</span>
    {:else if result !== undefined}
      <button
        onclick={() => collapsed = !collapsed}
        class="text-muted-foreground hover:text-foreground shrink-0"
      >
        {collapsed ? 'show' : 'hide'} ({resultLines.length} lines)
      </button>
    {/if}
  </div>

  {#if result !== undefined && !collapsed}
    <div class="relative group/fop-out">
      <CopyButton text={result} class="absolute top-1 right-1 opacity-0 group-hover/fop-out:opacity-100" />
      <pre class="mt-1 text-xs overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap
        {isError ? 'text-red-300' : 'text-muted-foreground'}">{result}</pre>
    </div>
  {/if}
</div>
