<script module lang="ts">
  /** The opening (dock.svelte: nextOpening) it last took the keyboard for:
   *  mounting again for the same one (its thread's pane coming back) leaves
   *  the keyboard where it is. */
  let focusedOpening = 0;
</script>

<script lang="ts">
  /**
   * The Focus panel: a Markdown file, plan or response as it reads, or a
   * text file as numbered lines. Docked beside the thread it was opened
   * from (SideDock), so the thread and its message box stay usable.
   */
  import MarkdownBlock from './MarkdownBlock.svelte';
  import CopyButton from './CopyButton.svelte';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { codeFileHtml } from '$lib/code-file.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  let contentEl = $state<HTMLDivElement | null>(null);

  /** A text file's numbered lines, coloured (lib/code-file). */
  let codeView = $derived(markdownPreviewStore.code
    ? codeFileHtml(markdownPreviewStore.content, markdownPreviewStore.code.path, markdownPreviewStore.code.lines)
    : null);

  // Esc closes it from inside only: in the message box beside it, Esc is
  // the box's own (closing the @ picker). Not when a menu in it took the
  // key (bits-ui marks it handled).
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    markdownPreviewStore.close();
  }

  // Scroll back to the top whenever new content is shown, or to the first
  // line a link pointed at, a third of the way down so the lines after it
  // show too.
  $effect(() => {
    markdownPreviewStore.content; // track
    const lines = markdownPreviewStore.code?.lines;
    if (!contentEl) return;
    const target = lines ? contentEl.querySelector<HTMLElement>(`[data-line="${lines.start}"]`) : null;
    contentEl.scrollTop = target
      ? target.getBoundingClientRect().top - contentEl.getBoundingClientRect().top + contentEl.scrollTop - contentEl.clientHeight / 3
      : 0;
  });

  // Focused when opened, so Esc and the arrow keys work on it at once.
  $effect(() => {
    const opening = markdownPreviewStore.opening;
    if (!contentEl || opening === focusedOpening) return;
    focusedOpening = opening;
    contentEl.focus({ preventScroll: true });
  });
</script>

{#if markdownPreviewStore.open}
  <!-- Focusable (tabindex -1) so a click anywhere in it lets Esc close it. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="flex-1 min-h-0 flex flex-col outline-none"
    aria-label="Focus panel"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <PanelHeader>
      <svg class="size-3.5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
      <span class="truncate font-medium text-foreground">{markdownPreviewStore.title}</span>
      {#snippet actions()}
        <CopyButton text={markdownPreviewStore.content} />
        <Button
          size="icon-2xs"
          variant="quiet"
          onclick={() => markdownPreviewStore.close()}
          title="Close (Esc)"
          aria-label="Close preview"
        >
          <XIcon />
        </Button>
      {/snippet}
    </PanelHeader>
    <div class="flex-1 overflow-y-auto px-6 py-4 text-sm outline-none" tabindex="-1" bind:this={contentEl}>
      {#if codeView}
        <!-- The gutter fits the last line's number. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- codeFileHtml escapes each line, or sanitizes highlight.js output with DOMPurify -->
        <div class="code-file text-xs font-mono" style:--gutter="{Math.max(2, String(codeView.lineCount).length)}ch">{@html codeView.html}</div>
      {:else}
        <MarkdownBlock content={markdownPreviewStore.content} sessionId={markdownPreviewStore.sessionId} baseDir={markdownPreviewStore.baseDir} />
      {/if}
    </div>
  </aside>
{/if}

<style>
  /* Each line hangs off its number, which CSS draws (so a copy leaves it
     out), and wraps rather than scrolling sideways, as diffs do. */
  .code-file :global(.code-line) {
    white-space: pre-wrap;
    word-break: break-all;
    padding-left: calc(var(--gutter) + 1.5ch);
    text-indent: calc(-1 * (var(--gutter) + 1.5ch));
  }
  .code-file :global(.code-line)::before {
    content: attr(data-line);
    display: inline-block;
    width: var(--gutter);
    margin-right: 1.5ch;
    text-align: right;
    text-indent: 0;
    color: var(--muted-foreground);
  }
  /* The lines a link pointed at. */
  .code-file :global(.code-line.target) {
    background-color: color-mix(in oklch, var(--primary) 18%, transparent);
  }
</style>
