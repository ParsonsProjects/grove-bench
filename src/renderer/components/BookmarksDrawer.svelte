<script module lang="ts">
  /** The opening (dock.svelte: nextOpening) it last took the keyboard for:
   *  mounting again for the same one (it moves to the thread you switch
   *  to) leaves the keyboard where it is. */
  let focusedOpening = 0;
</script>

<script lang="ts">
  /**
   * Bookmarks from every thread, docked beside the thread you're in
   * (SideDock), or beside the new-thread draft or the landing when no
   * thread is open. Opened from the sidebar or with Ctrl+B.
   */
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { openLink, opensInPreview } from '$lib/preview-links.js';
  import { localFileTarget, openWorktreeFile } from '$lib/worktree-files.js';
  import CopyButton from './CopyButton.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import FileIcon from '@lucide/svelte/icons/file';
  import type { Bookmark, BookmarkLink } from '../../shared/types.js';

  let groups = $derived(bookmarkStore.grouped);

  let editingId = $state<string | null>(null);
  let noteDraft = $state('');

  function repoColor(repoPath: string): string | null {
    return getRepoColor(store.repos, repoPath, settingsStore.current.repoColors);
  }

  function jump(b: Bookmark) {
    // Switch to the bookmark's session (the auto-resume effect in App.svelte
    // brings a stopped session back); the target OutputPanel resolves the anchor.
    if (store.activeSessionId !== b.sessionId
        && store.sessions.some((s) => s.id === b.sessionId)) {
      store.activeSessionId = b.sessionId;
    } else if (!store.sessions.some((s) => s.id === b.sessionId)) {
      // Session no longer open — nothing to jump to; surface the stored text.
      // (Drawer stays open so the snippet remains visible.)
      return;
    }
    messageStore.requestJump(b.sessionId, {
      eventIndex: b.eventIndex,
      uuid: b.messageUuid,
      bookmarkId: b.id,
    });
    bookmarkStore.toggleDrawer(false);
  }

  const threadOpen = (sessionId: string) => store.sessions.some((s) => s.id === sessionId);

  /** File links that found nothing when last clicked, by bookmark and href. */
  let missingFiles = $state(new Set<string>());
  const fileKey = (b: Bookmark, link: BookmarkLink) => `${b.id} ${link.href}`;

  function markMissing(key: string, missing: boolean) {
    if (missingFiles.has(key) === missing) return;
    const next = new Set(missingFiles);
    if (missing) next.add(key);
    else next.delete(key);
    missingFiles = next;
  }

  /** Where a link goes, shown beside its text: a web page's host, a file's
   *  path. Empty when the text already says it. */
  function linkDetail(link: BookmarkLink): string {
    let detail = link.href;
    if (link.kind === 'web') {
      try { detail = new URL(link.href).host; } catch { /* keep the address */ }
    }
    return link.text.includes(detail) ? '' : detail;
  }

  /** Open a bookmark's link as the thread would. A local page or a file opens
   *  in the bookmark's own thread (its Preview tab or Focus panel), so that
   *  thread is shown first; its dev server and worktree are the ones meant. */
  function openBookmarkLink(b: Bookmark, link: BookmarkLink, e: MouseEvent) {
    if (link.kind === 'web') {
      if (threadOpen(b.sessionId) && opensInPreview(link.href, e)) store.activeSessionId = b.sessionId;
      openLink(link.href, e);
      return;
    }
    const target = localFileTarget(link.href);
    if (!target || !threadOpen(b.sessionId)) return;
    store.activeSessionId = b.sessionId;
    const key = fileKey(b, link);
    openWorktreeFile(b.sessionId, target.path, target.hash, target.lines)
      .then((found) => markMissing(key, !found))
      .catch((err) => console.warn(`Could not open ${target.path}:`, err));
  }

  function startEdit(b: Bookmark) {
    editingId = b.id;
    noteDraft = b.note ?? '';
  }

  async function saveNote(b: Bookmark) {
    await bookmarkStore.updateNote(b.id, noteDraft.trim());
    editingId = null;
  }

  // Focused as it opens (Ctrl+B), so Esc and the arrow keys work on it.
  let listEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const opening = bookmarkStore.opening;
    if (!listEl || opening === focusedOpening) return;
    focusedOpening = opening;
    listEl.focus({ preventScroll: true });
  });

  // Esc closes it from inside only: in the message box beside it, Esc is
  // the box's own.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    bookmarkStore.toggleDrawer(false);
  }
</script>

{#if bookmarkStore.drawerOpen}
  <!-- Focusable (tabindex -1) so a click anywhere in it lets Esc close it. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="flex-1 min-h-0 flex flex-col outline-none"
    aria-label="Bookmarks"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <PanelHeader>
      <h2 class="flex items-center gap-2 font-medium text-foreground">
        <svg class="size-3" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
        Bookmarks
      </h2>
      {#snippet actions()}
        <Button
          variant="quiet"
          size="icon-2xs"
          onclick={() => bookmarkStore.toggleDrawer(false)}
          title="Close (Esc)"
          aria-label="Close bookmarks"
        ><XIcon /></Button>
      {/snippet}
    </PanelHeader>

    <div class="flex-1 overflow-y-auto px-3 py-2 outline-none" tabindex="-1" bind:this={listEl}>
      {#if groups.length === 0}
        <p class="text-xs text-muted-foreground mt-4 text-center">
          No bookmarks yet. Select text in the activity thread and click <em>Bookmark</em>.
        </p>
      {/if}

      {#each groups as repo (repo.repoPath)}
        {@const color = repoColor(repo.repoPath)}
        <div class="mt-3 first:mt-0">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
            {#if color}
              <span class="inline-block w-2 h-2 shrink-0" style="background-color: {color}"></span>
            {/if}
            <span class="truncate">{store.repoDisplayName(repo.repoPath)}</span>
          </div>

          {#each repo.sessions as session (session.sessionId)}
            <div class="ml-1 pl-2 border-l border-border/60">
              <div class="text-caption text-muted-foreground mb-1 truncate">{session.sessionLabel}</div>

              {#each session.bookmarks as b (b.id)}
                <div class="group mb-2 border border-border bg-card/80 p-2">
                  <pre class="whitespace-pre-wrap break-words text-xs text-foreground/90 max-h-24 overflow-y-auto m-0">{b.selectedText}</pre>

                  {#if b.links?.length}
                    <ul class="mt-1.5 flex flex-col gap-0.5" aria-label="Links in this bookmark">
                      {#each b.links as link (link.kind + ' ' + link.href)}
                        {@const detail = linkDetail(link)}
                        {@const closed = link.kind === 'file' && !threadOpen(b.sessionId)}
                        <li class="flex min-w-0 items-center gap-1.5 text-caption">
                          <Button
                            variant="external"
                            size="inline"
                            class="min-w-0 shrink justify-start"
                            onclick={(e: MouseEvent) => openBookmarkLink(b, link, e)}
                            disabled={closed}
                            title={closed ? `${link.href} (its thread isn't open)` : link.href}
                          >
                            {#if link.kind === 'web'}<ExternalLinkIcon />{:else}<FileIcon />{/if}
                            <span class="truncate">{link.text}</span>
                          </Button>
                          {#if missingFiles.has(fileKey(b, link))}
                            <span class="shrink-0 text-muted-foreground">(not found in this thread's worktree)</span>
                          {:else if detail}
                            <span class="min-w-0 truncate text-muted-foreground">{detail}</span>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  {#if editingId === b.id}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="mt-2 w-full text-xs bg-background border border-border px-1 py-0.5"
                      bind:value={noteDraft}
                      placeholder="Add a note…"
                      autofocus
                      onkeydown={(e) => { if (e.key === 'Enter') void saveNote(b); if (e.key === 'Escape') { e.stopPropagation(); editingId = null; } }}
                      onblur={() => saveNote(b)}
                    />
                  {:else if b.note}
                    <button class="mt-1 text-caption text-muted-foreground italic text-left w-full hover:text-foreground" onclick={() => startEdit(b)}>
                      {b.note}
                    </button>
                  {/if}

                  <div class="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Button
                      variant="subtle-primary"
                      size="2xs"
                      onclick={() => jump(b)}
                      title="Jump to source"
                    >Jump</Button>
                    {#if editingId !== b.id && !b.note}
                      <Button
                        variant="subtle"
                        size="2xs"
                        onclick={() => startEdit(b)}
                        title="Add note"
                      >Note</Button>
                    {/if}
                    <CopyButton text={b.selectedText} class="size-5" />
                    <Button
                      variant="quiet-destructive"
                      size="2xs"
                      onclick={() => bookmarkStore.remove(b.id)}
                      class="ml-auto"
                      title="Delete bookmark"
                    >Delete</Button>
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </aside>
{/if}
