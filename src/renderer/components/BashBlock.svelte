<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import { linkifyLocalhost, hasLocalhostUrl } from '$lib/linkify.js';

  let {
    toolInput,
    result,
    isError,
    pending,
    summaryMode = false,
  }: {
    toolInput: unknown;
    result?: string;
    isError?: boolean;
    pending: boolean;
    summaryMode?: boolean;
  } = $props();

  let expanded = $state(true);

  let command = $derived(
    (typeof toolInput === 'object' && toolInput !== null && 'command' in toolInput)
      ? String((toolInput as Record<string, unknown>).command)
      : ''
  );

  const PREVIEW_LINES = 20;

  /** Number of lines without materializing a split array of the whole output. */
  function countLines(text: string): number {
    let n = 1;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
    return n;
  }

  /** The first `count` lines of `text`. */
  function firstLines(text: string, count: number): string {
    let idx = -1;
    for (let i = 0; i < count; i++) {
      idx = text.indexOf('\n', idx + 1);
      if (idx === -1) return text;
    }
    return text.slice(0, idx);
  }

  let lineCount = $derived(result ? countLines(result) : 0);
  let isLong = $derived(lineCount > PREVIEW_LINES);
  let collapsed = $state(true);
  let summaryOutputExpanded = $state(false);
  let hasLinks = $derived(result ? hasLocalhostUrl(result) : false);
  // Only computed while the collapsed preview is actually shown.
  let preview = $derived(result && isLong && collapsed && !summaryMode ? firstLines(result, PREVIEW_LINES) : '');

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Escape HTML first, then linkify localhost URLs so tags aren't double-escaped. */
  function linkifyOutput(text: string): string {
    return linkifyLocalhost(escapeHtml(text));
  }

  function handleLinkClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const link = target.closest('a.localhost-link') as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      const url = link.dataset.url || link.href;
      window.groveBench.openExternal(url);
    }
  }
</script>

<div class="py-1 my-1 border-l-4 border-border pl-3">
  <!-- Command -->
  <div class="flex items-center gap-2 group/cmd">
    <span class="text-cyan-400 text-xs select-none font-bold">$</span>
    <code class="text-xs text-foreground flex-1 break-all">{command}</code>
    <CopyButton text={command} class="opacity-0 group-hover/cmd:opacity-100 shrink-0" />
    {#if pending}
      <span class="w-2.5 h-2.5 bg-primary animate-pulse shrink-0"></span>
    {:else if isError}
      <span class="text-xs text-destructive">error</span>
      {#if summaryMode && result !== undefined}
        <button
          onclick={() => summaryOutputExpanded = !summaryOutputExpanded}
          class="text-xs text-muted-foreground hover:text-foreground shrink-0"
        >
          {summaryOutputExpanded ? 'hide' : 'show'} ({lineCount} lines)
        </button>
      {/if}
    {:else if result !== undefined}
      {#if summaryMode}
        <button
          onclick={() => summaryOutputExpanded = !summaryOutputExpanded}
          class="text-xs text-muted-foreground hover:text-foreground shrink-0"
        >
          {summaryOutputExpanded ? 'hide' : 'show'} ({lineCount} lines)
        </button>
      {:else}
        <span class="text-xs text-muted-foreground">done</span>
      {/if}
    {/if}
  </div>

  <!-- Output -->
  {#if result !== undefined && summaryMode}
    <!-- Summary mode: show toggle to expand output -->
    {#if summaryOutputExpanded}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mt-1 relative group/out" onclick={handleLinkClick}>
        <CopyButton text={result} class="absolute top-1 right-1 opacity-0 group-hover/out:opacity-100" />
        {#if hasLinks}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{@html linkifyOutput(result)}</pre>
        {:else}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{result}</pre>
        {/if}
        <button
          onclick={() => summaryOutputExpanded = false}
          class="text-xs text-primary hover:text-primary/80 mt-1"
        >
          hide
        </button>
      </div>
    {/if}
  {:else if result !== undefined}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mt-1 relative group/out" onclick={handleLinkClick}>
      <CopyButton text={result} class="absolute top-1 right-1 opacity-0 group-hover/out:opacity-100" />
      {#if isLong && collapsed}
        {#if hasLinks}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{@html linkifyOutput(preview)}</pre>
        {:else}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{preview}</pre>
        {/if}
        <button
          onclick={() => collapsed = false}
          class="text-xs text-primary hover:text-primary/80 mt-1"
        >
          Show all {lineCount} lines
        </button>
      {:else}
        {#if hasLinks}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{@html linkifyOutput(result)}</pre>
        {:else}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{result}</pre>
        {/if}
        {#if isLong}
          <button
            onclick={() => collapsed = true}
            class="text-xs text-primary hover:text-primary/80 mt-1"
          >
            Collapse
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  :global(a.localhost-link) {
    color: #4ade80;
    text-decoration: underline;
    cursor: pointer;
  }
  :global(a.localhost-link:hover) {
    color: #86efac;
  }
</style>
