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

  let outputLines = $derived(result ? result.split('\n') : []);
  let isLong = $derived(outputLines.length > 20);
  let collapsed = $state(true);
  let summaryOutputExpanded = $state(false);
  let hasLinks = $derived(result ? hasLocalhostUrl(result) : false);

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
          {summaryOutputExpanded ? 'hide' : 'show'} ({outputLines.length} lines)
        </button>
      {/if}
    {:else if result !== undefined}
      {#if summaryMode}
        <button
          onclick={() => summaryOutputExpanded = !summaryOutputExpanded}
          class="text-xs text-muted-foreground hover:text-foreground shrink-0"
        >
          {summaryOutputExpanded ? 'hide' : 'show'} ({outputLines.length} lines)
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
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{@html linkifyOutput(outputLines.slice(0, 20).join('\n'))}</pre>
        {:else}
          <pre class="text-xs text-muted-foreground overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap {isError ? 'text-red-300' : ''}">{outputLines.slice(0, 20).join('\n')}</pre>
        {/if}
        <button
          onclick={() => collapsed = false}
          class="text-xs text-primary hover:text-primary/80 mt-1"
        >
          Show all {outputLines.length} lines
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
