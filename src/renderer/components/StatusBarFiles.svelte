<script lang="ts">
  /**
   * The Files badge and its popover: every file that came into the thread
   * (shared/thread-items.ts), newest first, in three groups: the ones you
   * attached, the ones the agent made, and images tools returned. A click
   * opens the file as its chip in the thread does (an image full size, a
   * text file in the Focus panel, a web page in the Preview tab, the rest
   * in their default app); the button beside it shows the message it came
   * with. Shows only once the thread has a file.
   */
  import LocateFixedIcon from '@lucide/svelte/icons/locate-fixed';
  import { Button } from '$lib/components/ui/button/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import StatusBarPopover from './StatusBarPopover.svelte';
  import AttachmentIcon from './AttachmentIcon.svelte';
  import ImageLightbox from './ImageLightbox.svelte';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { formatFileSize } from '$lib/file-attachments.js';
  import { openWorktreeFile } from '$lib/worktree-files.js';
  import {
    attachedTextContent, showInThread, textFileMarkdown, threadFileName, threadFileSize, threadImageSrc,
  } from '$lib/thread-files.js';
  import { threadFileKey, type ThreadFile } from '../../shared/thread-items.js';

  let { sessionId, files }: { sessionId: string; files: ThreadFile[] } = $props();

  let open = $state(false);
  let lightbox = $state<{ src: string; label: string } | null>(null);
  /** Files that turned out to be gone (a cleared folder, a deleted worktree
   *  file, a message a rewind took), by threadFileKey. */
  let missing = $state<Record<string, true>>({});

  const GROUPS: { title: string; has: (f: ThreadFile) => boolean }[] = [
    { title: 'You attached', has: (f) => f.kind === 'text' || f.kind === 'file' || (f.kind === 'image' && f.from === 'user') },
    { title: 'Made by the agent', has: (f) => f.kind === 'made' },
    { title: 'From tools', has: (f) => f.kind === 'image' && f.from === 'tool' },
  ];
  let groups = $derived(GROUPS.map((g) => ({ title: g.title, files: files.filter(g.has) })).filter((g) => g.files.length > 0));

  /** The type AttachmentIcon draws: a PDF, audio, or a plain file. */
  function iconType(f: ThreadFile): string | undefined {
    if (f.kind === 'file') return f.file.mediaType;
    if (f.kind === 'made') return f.made.kind === 'pdf' ? 'application/pdf' : f.made.kind === 'audio' ? 'audio/mpeg' : undefined;
    return undefined;
  }

  function openTitle(f: ThreadFile, name: string): string {
    if (missing[threadFileKey(f)]) return `${name} is no longer available`;
    const size = threadFileSize(f);
    const where = f.kind === 'text' ? ' in the Focus panel' : f.kind === 'made' && f.made.kind === 'html' ? ' in the Preview tab' : '';
    return `Open ${name}${size !== undefined ? ` (${formatFileSize(size)})` : ''}${where}`;
  }

  async function openFile(f: ThreadFile) {
    const key = threadFileKey(f);
    const name = threadFileName(f);
    const src = threadImageSrc(sessionId, f);
    if (src) {
      open = false;
      lightbox = { src, label: name };
      return;
    }
    try {
      if (f.kind === 'text') {
        const content = await attachedTextContent(sessionId, f.eventIndex, f.name);
        if (content === null) {
          missing[key] = true;
          return;
        }
        open = false;
        markdownPreviewStore.show(textFileMarkdown(f.name, content), f.name, sessionId);
      } else if (f.kind === 'file') {
        if (!(await window.groveBench.openAttachedFile(sessionId, f.file.file))) missing[key] = true;
      } else if (f.kind === 'made') {
        if (!(await openWorktreeFile(sessionId, f.made.path))) missing[key] = true;
        else if (f.made.kind === 'html') open = false;
      }
    } catch (err) {
      console.warn(`Could not open ${name}:`, err);
    }
  }

  function jump(f: ThreadFile) {
    open = false;
    showInThread(sessionId, f.eventIndex);
  }
</script>

{#if files.length > 0}
  <StatusBarPopover bind:open anchored={false} panelClass="w-96" label="Files">
    {#snippet trigger()}
      <button
        onclick={() => (open = !open)}
        class="flex items-center gap-1 whitespace-nowrap transition-colors text-muted-foreground hover:text-foreground"
        title="Files you attached, the agent made, and tools returned"
        aria-expanded={open}
      >
        <span class="w-1.5 h-1.5 bg-muted-foreground/50"></span>
        Files {files.length}
      </button>
    {/snippet}

    <div class="font-medium text-foreground mb-2">Files</div>
    <div class="space-y-2 max-h-80 overflow-y-auto">
      {#each groups as group (group.title)}
        <section>
          <SectionLabel class="mb-1">{group.title}</SectionLabel>
          <ul class="space-y-0.5">
            {#each group.files as f (threadFileKey(f))}
              {@const key = threadFileKey(f)}
              {@const name = threadFileName(f)}
              {@const size = threadFileSize(f)}
              {@const src = threadImageSrc(sessionId, f)}
              {@const gone = !!missing[key]}
              <li class="flex items-center gap-2">
                <button
                  type="button"
                  onclick={() => openFile(f)}
                  disabled={gone}
                  class="group/open flex items-center gap-2 min-w-0 flex-1 text-left disabled:opacity-60"
                  title={openTitle(f, name)}
                >
                  {#if src && !gone}
                    <img
                      {src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onerror={() => (missing[key] = true)}
                      class="size-6 shrink-0 object-cover border border-border/60
                        bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:8px_8px]"
                    />
                  {:else}
                    <span class="size-6 shrink-0 flex items-center justify-center border border-border/60 text-muted-foreground">
                      <AttachmentIcon mediaType={iconType(f)} />
                    </span>
                  {/if}
                  <span class="font-mono truncate text-foreground {gone ? '' : 'group-hover/open:underline'}">{name}</span>
                  {#if size !== undefined}
                    <span class="text-caption text-muted-foreground shrink-0">{formatFileSize(size)}</span>
                  {/if}
                </button>
                <Button
                  variant="quiet"
                  size="icon-2xs"
                  onclick={() => jump(f)}
                  title="Show the message it came with"
                  aria-label="Show {name} in the thread"
                >
                  <LocateFixedIcon />
                </Button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </StatusBarPopover>
{/if}

<!-- Outside the popover, which closes (and would take it along) on the
     click that lands in the dialog. -->
<ImageLightbox src={lightbox?.src ?? null} label={lightbox?.label ?? ''} onclose={() => (lightbox = null)} />
