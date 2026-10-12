<script lang="ts">
  /**
   * The files the agent made in a turn, just before its result: images as
   * thumbnails (the copy taken when the turn ended, else the file as it is
   * now), and the rest as chips that open them: a web page in the Preview
   * tab, PDFs, media and documents in their default app.
   */
  import ImageAttachments from './ImageAttachments.svelte';
  import AttachmentIcon from './AttachmentIcon.svelte';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import { formatFileSize } from '$lib/file-attachments.js';
  import { openWorktreeFile } from '$lib/worktree-files.js';
  import { worktreeFileUrl } from '../../shared/attachments.js';
  import type { MadeFile, MadeFileKind } from '../../shared/types.js';
  import type { ThreadImage } from '../stores/messages.svelte.js';

  let { sessionId, files, more }: { sessionId: string; files: MadeFile[]; more?: number } = $props();

  let images = $derived(files.filter((f) => f.kind === 'image').map((f): ThreadImage =>
    f.image ? { file: f.image.file, name: f.path } : { name: f.path, url: worktreeFileUrl(sessionId, f.path) }));
  let others = $derived(files.filter((f) => f.kind !== 'image'));
  /** Files that turned out to be gone (or the worktree is). */
  let missing = $state<Record<string, true>>({});

  /** The type AttachmentIcon draws for a kind: a PDF, audio, or a plain file. */
  const ICON_TYPE: Partial<Record<MadeFileKind, string>> = { pdf: 'application/pdf', audio: 'audio/mpeg' };

  const OPENS_IN: Partial<Record<MadeFileKind, string>> = { html: 'the Preview tab' };

  async function open(f: MadeFile) {
    try {
      if (!(await openWorktreeFile(sessionId, f.path))) missing[f.path] = true;
    } catch (err) {
      console.warn(`Could not open ${f.path}:`, err);
    }
  }
</script>

<div class="py-1 my-1">
  <SectionLabel>Files made</SectionLabel>
  {#if images.length}
    <ImageAttachments {sessionId} {images} class="mt-1" />
  {/if}
  {#if others.length}
    <div class="flex flex-wrap gap-1.5 mt-1">
      {#each others as f (f.path)}
        <button
          type="button"
          onclick={() => open(f)}
          disabled={missing[f.path]}
          class="inline-flex items-center gap-1 max-w-full text-xs px-2 py-1 font-mono border border-border/60
            enabled:hover:border-primary/50 disabled:opacity-60 transition-colors"
          title={missing[f.path]
            ? `${f.path} is no longer in the worktree`
            : `Open ${f.path} (${formatFileSize(f.size)})${OPENS_IN[f.kind] ? ` in ${OPENS_IN[f.kind]}` : ''}`}
        >
          <AttachmentIcon mediaType={ICON_TYPE[f.kind]} />
          <span class="truncate">{f.path}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if more}
    <div class="text-caption text-muted-foreground mt-1">and {more} more</div>
  {/if}
</div>
