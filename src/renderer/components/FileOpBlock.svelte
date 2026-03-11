<script lang="ts">
  let {
    toolName,
    toolInput,
    result,
    pending,
    isError,
  }: {
    toolName: string;
    toolInput: unknown;
    result?: string;
    pending: boolean;
    isError?: boolean;
  } = $props();

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

<div class="py-1 my-1 border-l-4 border-neutral-600 pl-3">
  <div class="flex items-center gap-2 text-xs">
    <span class="text-neutral-400 font-bold">{toolName}</span>
    <span class="text-neutral-300 truncate flex-1">{summary}</span>
    {#if pending}
      <span class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></span>
    {:else if isError}
      <span class="text-red-400">error</span>
    {:else if result !== undefined}
      <button
        onclick={() => collapsed = !collapsed}
        class="text-neutral-500 hover:text-neutral-300 shrink-0"
      >
        {collapsed ? 'show' : 'hide'} ({resultLines.length} lines)
      </button>
    {/if}
  </div>

  {#if result !== undefined && !collapsed}
    <pre class="mt-1 text-xs overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap
      {isError ? 'text-red-300' : 'text-neutral-400'}">{result}</pre>
  {/if}
</div>
