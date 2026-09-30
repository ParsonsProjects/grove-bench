<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';
  import CopyButton from './CopyButton.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import type { SentBlock } from '../../shared/prompt-text.js';
  import type { ThreadImage } from '../stores/messages.svelte.js';

  let {
    sessionId,
    text,
    files,
    images,
    onRewind,
  }: {
    sessionId: string;
    text: string;
    /** Text files attached to the message, shown as chips that open their content. */
    files?: SentBlock[];
    images?: ThreadImage[];
    /** When set, a "Rewind to here" action is shown on hover. Only messages
     *  with a checkpoint (a uuid) get one. */
    onRewind?: () => void;
  } = $props();

  let openFile = $state<number | null>(null);
  let shownFile = $derived(openFile !== null ? files?.[openFile] : undefined);
</script>

<div class="user-prompt group py-2.5 px-3 my-1 text-sm text-foreground bg-primary/8 border-l-2 border-primary flex items-start">
  <span class="text-primary select-none mr-2 shrink-0 leading-[1.6]">&gt;</span>
  <div class="min-w-0 flex-1 flex flex-col gap-1.5">
    {#if files?.length}
      <div class="flex flex-wrap gap-1.5">
        {#each files as file, i (i)}
          <button
            type="button"
            onclick={() => (openFile = openFile === i ? null : i)}
            class="inline-flex items-center gap-1 max-w-full bg-primary/15 text-primary text-xs px-2 py-1 font-mono border
              {openFile === i ? 'border-primary/60' : 'border-primary/25 hover:border-primary/50'} transition-colors"
            title={openFile === i ? `Hide ${file.path}` : `Show ${file.path}`}
            aria-expanded={openFile === i}
          >
            <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.5 1A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V5.621a1 1 0 00-.293-.707l-3.621-3.621A1 1 0 009.379 1H3.5z"/>
            </svg>
            <span class="truncate">{file.path}</span>
          </button>
        {/each}
      </div>
      {#if shownFile}
        <div class="relative group/att">
          <CopyButton text={shownFile.content} class="absolute top-1 right-1 opacity-0 group-hover/att:opacity-100" />
          <pre class="text-xs text-muted-foreground bg-card p-2 max-h-64 overflow-auto whitespace-pre-wrap">{shownFile.content}</pre>
        </div>
      {/if}
    {/if}
    {#if images?.length}
      <ImageAttachments {sessionId} {images} />
    {/if}
    {#if text.trim()}
      <MarkdownBlock content={text} />
    {/if}
  </div>
  {#if onRewind}
    <button
      type="button"
      onclick={onRewind}
      class="shrink-0 ml-2 -my-0.5 p-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100
        hover:text-foreground hover:bg-card/80 transition-colors"
      title="Rewind to this message"
      aria-label="Rewind to this message"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .user-prompt :global(.markdown-content > p:first-child) {
    margin-top: 0;
  }
  .user-prompt :global(.markdown-content > p:last-child) {
    margin-bottom: 0;
  }
</style>
