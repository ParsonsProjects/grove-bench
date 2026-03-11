<script lang="ts">
  let {
    toolInput,
    result,
    isError,
    pending,
  }: {
    toolInput: unknown;
    result?: string;
    isError?: boolean;
    pending: boolean;
  } = $props();

  let expanded = $state(true);

  let command = $derived(
    (typeof toolInput === 'object' && toolInput !== null && 'command' in toolInput)
      ? String((toolInput as Record<string, unknown>).command)
      : ''
  );

  let outputLines = $derived(result ? result.split('\n') : []);
  let isLong = $derived(outputLines.length > 20);
  let collapsed = $state(true);
</script>

<div class="py-1 my-1 border-l-4 border-neutral-600 pl-3">
  <!-- Command -->
  <div class="flex items-center gap-2">
    <span class="text-cyan-400 text-xs select-none font-bold">$</span>
    <code class="text-xs text-neutral-200 flex-1 break-all">{command}</code>
    {#if pending}
      <span class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></span>
    {:else if isError}
      <span class="text-xs text-red-400">error</span>
    {:else if result !== undefined}
      <span class="text-xs text-neutral-500">done</span>
    {/if}
  </div>

  <!-- Output -->
  {#if result !== undefined}
    <div class="mt-1">
      {#if isLong && collapsed}
        <pre class="text-xs text-neutral-400 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{outputLines.slice(0, 20).join('\n')}</pre>
        <button
          onclick={() => collapsed = false}
          class="text-xs text-blue-400 hover:text-blue-300 mt-1"
        >
          Show all {outputLines.length} lines
        </button>
      {:else}
        <pre class="text-xs text-neutral-400 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{result}</pre>
        {#if isLong}
          <button
            onclick={() => collapsed = true}
            class="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >
            Collapse
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>
