<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import type { ToolView } from '../../shared/tool-view.js';

  let {
    sessionId,
    toolName,
    view,
    result,
    pending,
    isError,
  }: {
    sessionId: string;
    toolName: string;
    /** The read or search call (see shared/tool-view.ts). */
    view: ToolView;
    result?: string;
    pending: boolean;
    isError?: boolean;
  } = $props();

  /** A file read, which can open in the editor (a search names a folder or nothing). */
  let isFileRead = $derived(view.kind === 'read' && !!view.path);

  function openInEditor() {
    if (isFileRead && view.path) {
      window.groveBench.openInEditor(sessionId, view.path).catch(() => {});
    }
  }

  let collapsed = $state(true);

  /** What the copy button copies: the file read, or the search pattern. */
  let filePath = $derived(view.kind === 'search' ? (view.pattern ?? view.path ?? '') : (view.path ?? ''));

  let summary = $derived.by(() => {
    if (view.kind === 'search') return `${toolName.toLowerCase()}: ${view.pattern ?? ''}`;
    return view.path ?? '';
  });

  let resultLines = $derived(result ? result.split('\n') : []);
  let isLong = $derived(resultLines.length > 15);
</script>

<div class="py-1 my-1 border-l-4 border-border pl-3">
  <div class="flex items-center gap-2 text-xs group/fop-hdr">
    <span class="text-muted-foreground font-bold">{toolName}</span>
    {#if isFileRead}
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
      <span class="w-2.5 h-2.5 bg-primary animate-pulse shrink-0"></span>
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
