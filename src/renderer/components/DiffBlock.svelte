<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import DiffView, { computeDiffLines } from './DiffView.svelte';
  import type { ToolView } from '../../shared/tool-view.js';

  let {
    sessionId,
    view,
    result,
    pending,
    isError,
    summaryMode = false,
  }: {
    sessionId: string;
    /** The edit call (see shared/tool-view.ts). */
    view: ToolView;
    result?: string;
    pending: boolean;
    isError?: boolean;
    summaryMode?: boolean;
  } = $props();

  let sideBySide = $state(false);
  let filePath = $derived(view.path || 'file');
  /** A whole-file write rather than replacements within the file. */
  let isWrite = $derived(!view.edits?.length && view.write !== undefined);

  let diffLines = $derived(pending ? [] : computeDiffLines(view, filePath));

  let copyContent = $derived(isWrite ? (view.write ?? '') : (view.edits ?? []).map((e) => e.newText).join('\n'));

  function openInEditor() {
    window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
  }
</script>

{#if summaryMode}
  <div class="py-0.5 my-0.5 border-l-4 border-primary pl-3">
    <div class="flex items-center gap-2 text-xs group/diff-hdr">
      <span class="text-primary font-bold">{isWrite ? '+ new' : 'edit'}</span>
      <button
        onclick={openInEditor}
        class="text-foreground/80 hover:text-primary hover:underline cursor-pointer truncate"
        title="Open in editor"
      >{filePath}</button>
      {#if pending}
        <span class="w-2.5 h-2.5 bg-primary animate-pulse shrink-0"></span>
      {:else if isError}
        <span class="text-destructive">error</span>
      {/if}
    </div>
  </div>
{:else}
  <div class="py-1 my-1 border-l-4 border-primary pl-3">
    <!-- Header -->
    <div class="flex items-center gap-2 text-xs mb-1 group/diff-hdr">
      <span class="text-primary font-bold">{isWrite ? '+ new file' : 'edit'}</span>
      <button
        onclick={openInEditor}
        class="text-foreground/80 hover:text-primary hover:underline cursor-pointer"
        title="Open in editor"
      >{filePath}</button>
      <CopyButton text={filePath} class="opacity-0 group-hover/diff-hdr:opacity-100 shrink-0" />
      {#if pending}
        <span class="w-2.5 h-2.5 bg-primary animate-pulse shrink-0"></span>
      {:else if isError}
        <span class="text-destructive">error</span>
      {:else if diffLines.length > 0}
        <div class="ml-auto flex items-center gap-1">
          <CopyButton text={copyContent} class="opacity-0 group-hover/diff-hdr:opacity-100" />
          {#if !isWrite}
            <button
              onclick={() => sideBySide = !sideBySide}
              class="text-muted-foreground hover:text-foreground select-none"
            >
              {sideBySide ? 'unified' : 'side-by-side'}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <DiffView lines={diffLines} {sideBySide} />

    {#if isError && result}
      <div class="text-xs text-destructive mt-1">{result}</div>
    {/if}
  </div>
{/if}
