<script lang="ts">
  /** Files attached to a message before it is sent, one chip each with a
   *  remove button. Used by the thread's prompt box and the new thread pane. */
  import { Button } from '$lib/components/ui/button/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import { type AttachedFile, formatFileSize } from '$lib/file-attachments.js';
  import AttachmentIcon from './AttachmentIcon.svelte';

  let { files, onremove, class: className = '' }: {
    files: AttachedFile[];
    onremove: (index: number) => void;
    class?: string;
  } = $props();
</script>

<div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto {className}">
  {#each files as file, i}
    <span
      class="inline-flex items-center gap-1 bg-primary/15 text-primary text-xs px-2 py-1 font-mono border border-primary/25"
      title={file.type === 'file' ? `${file.name} (${formatFileSize(file.size)})` : undefined}
    >
      {#if file.type === 'image'}
        <img src={file.dataUrl} alt={file.name} class="w-5 h-5 object-cover shrink-0" />
      {:else}
        <AttachmentIcon mediaType={file.type === 'file' ? file.mediaType : ''} />
      {/if}
      {file.name}
      <Button
        variant="quiet-destructive"
        size="icon-2xs"
        onclick={() => onremove(i)}
        class="-my-0.5 -mr-1"
        title="Remove"
        aria-label="Remove {file.name}"
      ><XIcon /></Button>
    </span>
  {/each}
</div>
