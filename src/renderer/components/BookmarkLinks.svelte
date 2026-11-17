<script lang="ts">
  /**
   * The links a bookmark kept from its selection (Bookmark.links), under its
   * text: in the Bookmarks panel, and in the thread's notice when a jump
   * can't find the text it came from. A click opens a link as the thread
   * would. A local page, or a file that shows in the app, opens in the
   * bookmark's own thread, so that thread is shown first: its dev server and
   * worktree are the ones the link meant.
   */
  import { store } from '../stores/sessions.svelte.js';
  import { isPreviewLink, openLink } from '$lib/preview-links.js';
  import { localFileTarget, openWorktreeFile } from '$lib/worktree-files.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import FileIcon from '@lucide/svelte/icons/file';
  import type { Bookmark, BookmarkLink } from '../../shared/types.js';

  let { bookmark }: { bookmark: Bookmark } = $props();

  let threadOpen = $derived(store.sessions.some((s) => s.id === bookmark.sessionId));

  /** File links that found nothing when last clicked, by href. */
  let missing = $state(new Set<string>());

  function markMissing(href: string, gone: boolean) {
    if (missing.has(href) === gone) return;
    const next = new Set(missing);
    if (gone) next.add(href);
    else next.delete(href);
    missing = next;
  }

  /** Where a link goes, beside its text: a web page's host, a file's path.
   *  Empty when the text already says it. */
  function linkDetail(link: BookmarkLink): string {
    let detail = link.href;
    if (link.kind === 'web') {
      try { detail = new URL(link.href).host; } catch { /* keep the address */ }
    }
    return link.text.includes(detail) ? '' : detail;
  }

  function showThread() {
    store.activeSessionId = bookmark.sessionId;
  }

  function open(link: BookmarkLink, e: MouseEvent) {
    if (link.kind === 'web') {
      // Shown first, so openLink finds a thread even from the landing.
      if (threadOpen && isPreviewLink(link.href, e)) showThread();
      openLink(link.href, e);
      return;
    }
    const target = localFileTarget(link.href);
    if (!target || !threadOpen) return;
    // Shown only for a file that opens in the app: one another app opens
    // (a PDF) leaves you where you are, and a stopped thread asleep.
    openWorktreeFile(bookmark.sessionId, target.path, target.hash, target.lines, showThread)
      .then((found) => markMissing(link.href, !found))
      .catch((err) => console.warn(`Could not open ${target.path}:`, err));
  }
</script>

{#if bookmark.links?.length}
  <ul class="mt-1.5 flex flex-col gap-0.5" aria-label="Links in this bookmark">
    {#each bookmark.links as link (link.kind + ' ' + link.href)}
      {@const detail = linkDetail(link)}
      {@const closed = link.kind === 'file' && !threadOpen}
      <li class="flex min-w-0 items-center gap-1.5 text-caption">
        <!-- Blue goes (a web page), green acts (a file the app opens). -->
        <Button
          variant={link.kind === 'web' ? 'external' : 'link'}
          size="inline"
          class="min-w-0 shrink justify-start"
          onclick={(e: MouseEvent) => open(link, e)}
          disabled={closed}
          title={closed ? `${link.href} (its thread isn't open)` : link.href}
        >
          {#if link.kind === 'web'}<ExternalLinkIcon />{:else}<FileIcon />{/if}
          <span class="truncate">{link.text}</span>
        </Button>
        {#if missing.has(link.href)}
          <span class="shrink-0 text-muted-foreground">(not found in this thread's worktree)</span>
        {:else if detail}
          <span class="min-w-0 truncate text-muted-foreground">{detail}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
