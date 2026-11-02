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
  import CopyButton from './CopyButton.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Bookmark } from '../../shared/types.js';

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
