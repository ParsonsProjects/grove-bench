<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import DiffView, { computeDiffLines } from './DiffView.svelte';
  import LargeDiffNotice from './LargeDiffNotice.svelte';
  import { editSize, isLargeDiff } from '../lib/diff-highlight.js';
  import type { ToolView } from '../../shared/tool-view.js';
  import { isMarkdownFile } from '../../shared/attachments.js';
  import { openWorktreeFile } from '$lib/worktree-files.js';

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

  /** A large edit waits for "Show edit" before its diff is worked out:
   *  createPatch and drawing every row would stall the window. */
  let size = $derived(editSize(view));
  let shown = $state(false);
  let heldBack = $derived(!pending && !shown && isLargeDiff(size));

  let diffLines = $derived(pending || heldBack ? [] : computeDiffLines(view, filePath));

  let copyContent = $derived(isWrite ? (view.write ?? '') : (view.edits ?? []).map((e) => e.newText).join('\n'));

  function openInEditor() {
    window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
  }

  /** A Markdown file can be read as it renders, in the Focus panel. */
  let isMarkdown = $derived(isMarkdownFile(filePath));
  /** It's no longer in the worktree. */
  let gone = $state(false);
  async function preview() {
    try {
      gone = !(await openWorktreeFile(sessionId, filePath));
    } catch (err) {
      console.warn(`Could not preview ${filePath}:`, err);
    }
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
        <Pulse />
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
        <Pulse />
      {:else if isError}
        <span class="text-destructive">error</span>
      {:else if heldBack || diffLines.length > 0}
        <div class="ml-auto flex items-center gap-1">
          <CopyButton text={copyContent} class="opacity-0 group-hover/diff-hdr:opacity-100" />
          {#if isMarkdown}
            <Button
              variant="quiet"
              size="inline"
              onclick={preview}
              disabled={gone}
              class="select-none"
              title={gone ? `${filePath} is no longer in the worktree` : 'Read the file as it is now, rendered, in the Focus panel'}
            >
              preview
            </Button>
          {/if}
          {#if !isWrite && !heldBack}
            <Button
              variant="quiet"
              size="inline"
              onclick={() => sideBySide = !sideBySide}
              class="select-none"
            >
              {sideBySide ? 'unified' : 'side-by-side'}
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    {#if heldBack}
      <LargeDiffNotice kind="edit" {size} label={`Show edit to ${filePath}`} onShow={() => (shown = true)} />
    {:else}
      <DiffView lines={diffLines} {sideBySide} {filePath} deferHighlight />
    {/if}

    {#if isError && result}
      <div class="text-xs text-destructive mt-1">{result}</div>
    {/if}
  </div>
{/if}
