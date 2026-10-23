<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import AttachmentIcon from './AttachmentIcon.svelte';
  import { formatFileSize } from '$lib/file-attachments.js';
  import { formatSentTime } from '$lib/message-dates.js';
  import { showAttachedText } from '$lib/thread-files.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { SentBlock } from '../../shared/prompt-text.js';
  import type { ThreadFile, ThreadImage } from '../stores/messages.svelte.js';

  let {
    sessionId,
    text,
    files,
    images,
    attachments,
    sentAt,
    onRewind,
  }: {
    sessionId: string;
    text: string;
    /** Text files attached to the message, shown as chips that open their
     *  content in the Focus panel. */
    files?: SentBlock[];
    images?: ThreadImage[];
    /** Other files attached (PDFs, audio, ...), shown as chips that open the
     *  saved copy. */
    attachments?: ThreadFile[];
    /** When it was sent (epoch ms), shown as a time. Older history has none. */
    sentAt?: number;
    /** When set, a "Rewind to here" action is shown on hover. Only messages
     *  with a checkpoint (a uuid) get one. */
    onRewind?: () => void;
  } = $props();

  /** Saved files that turned out to be gone (the folder was cleared). */
  let missing = $state<Record<string, true>>({});

  async function openAttachment(file: string) {
    try {
      if (!(await window.groveBench.openAttachedFile(sessionId, file))) missing[file] = true;
    } catch (err) {
      console.warn(`Could not open attached file ${file}:`, err);
    }
  }
</script>

<div class="user-prompt group py-2.5 px-3 my-1 text-sm text-foreground bg-primary/8 border-l-2 border-primary flex items-start">
  <span class="text-primary select-none mr-2 shrink-0 leading-[1.6]">&gt;</span>
  <div class="min-w-0 flex-1 flex flex-col gap-1.5">
    {#if files?.length}
      <div class="flex flex-wrap gap-1.5">
        {#each files as file, i (i)}
          <button
            type="button"
            onclick={() => showAttachedText(sessionId, file.path, file.content)}
            class="inline-flex items-center gap-1 max-w-full bg-primary/15 text-primary text-xs px-2 py-1 font-mono border
              border-primary/25 hover:border-primary/50 transition-colors"
            title="Open {file.path}"
          >
            <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.5 1A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V5.621a1 1 0 00-.293-.707l-3.621-3.621A1 1 0 009.379 1H3.5z"/>
            </svg>
            <span class="truncate">{file.path}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if images?.length}
      <ImageAttachments {sessionId} {images} />
    {/if}
    {#if attachments?.length}
      <div class="flex flex-wrap gap-1.5">
        {#each attachments as att, i (i)}
          {@const gone = !att.file || missing[att.file]}
          <button
            type="button"
            onclick={() => att.file && openAttachment(att.file)}
            disabled={gone}
            class="inline-flex items-center gap-1 max-w-full bg-primary/15 text-primary text-xs px-2 py-1 font-mono border
              border-primary/25 enabled:hover:border-primary/50 disabled:opacity-60 transition-colors"
            title={att.file && missing[att.file] ? `${att.name} is no longer available` : `${att.name} (${formatFileSize(att.size)})`}
          >
            <AttachmentIcon mediaType={att.mediaType} />
            <span class="truncate">{att.name}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if text.trim()}
      <MarkdownBlock content={text} />
    {/if}
  </div>
  {#if sentAt !== undefined}
    <!-- The outer span takes the prompt's line height, so the smaller time
         sits on the first line's baseline. -->
    <span class="ml-2 shrink-0 leading-[1.6] select-none">
      <time
        class="text-caption text-muted-foreground tabular-nums"
        datetime={new Date(sentAt).toISOString()}
        title="Sent {new Date(sentAt).toLocaleString()}"
      >{formatSentTime(sentAt)}</time>
    </span>
  {/if}
  {#if onRewind}
    <Button
      variant="quiet"
      size="icon-xs"
      onclick={onRewind}
      class="ml-2 -my-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      title="Rewind to this message"
      aria-label="Rewind to this message"
    >
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
      </svg>
    </Button>
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
