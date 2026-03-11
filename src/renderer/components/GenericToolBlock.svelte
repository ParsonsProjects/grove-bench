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

  let expanded = $state(false);

  function formatInput(input: unknown): string {
    if (typeof input === 'string') return input;
    try { return JSON.stringify(input, null, 2); }
    catch { return String(input); }
  }

  function summarizeInput(input: unknown): string {
    if (typeof input !== 'object' || input === null) return '';
    const obj = input as Record<string, unknown>;
    if (obj.file_path) return String(obj.file_path);
    if (obj.command) return String(obj.command).slice(0, 80);
    if (obj.pattern) return String(obj.pattern);
    if (obj.query) return String(obj.query).slice(0, 60);
    if (obj.url) return String(obj.url).slice(0, 60);
    if (obj.prompt) return String(obj.prompt).slice(0, 60);
    return '';
  }
</script>

<div class="py-1 my-1 border-l-4 border-border pl-3">
  <button
    onclick={() => expanded = !expanded}
    class="w-full flex items-center gap-2 text-left text-xs hover:bg-accent/30 -ml-1 pl-1 py-0.5"
  >
    <span class="text-muted-foreground font-bold">{toolName}</span>
    <span class="text-muted-foreground/70 truncate flex-1">{summarizeInput(toolInput)}</span>
    {#if pending}
      <span class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></span>
    {:else if isError}
      <span class="text-destructive">error</span>
    {:else if result !== undefined}
      <span class="text-muted-foreground">done</span>
    {/if}
    <span class="text-muted-foreground/40 transition-transform {expanded ? 'rotate-90' : ''}">&rsaquo;</span>
  </button>

  {#if expanded}
    <div class="mt-1 text-xs">
      <div class="text-muted-foreground mb-0.5">input</div>
      <pre class="text-muted-foreground bg-card p-2 overflow-x-auto max-h-48 overflow-y-auto">{formatInput(toolInput)}</pre>
      {#if result !== undefined}
        <div class="text-muted-foreground mt-1 mb-0.5">{isError ? 'error' : 'output'}</div>
        <pre class="overflow-x-auto max-h-64 overflow-y-auto p-2 bg-card whitespace-pre-wrap
          {isError ? 'text-red-300' : 'text-muted-foreground'}">{result}</pre>
      {/if}
    </div>
  {/if}
</div>
