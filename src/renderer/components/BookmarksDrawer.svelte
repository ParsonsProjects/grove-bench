<script lang="ts">
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import CopyButton from './CopyButton.svelte';
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
</script>

{#if bookmarkStore.drawerOpen}
  <!-- Backdrop -->
  <button
    class="fixed inset-0 z-40 bg-black/40"
    onclick={() => bookmarkStore.toggleDrawer(false)}
    aria-label="Close bookmarks"
  ></button>

  <aside class="fixed top-0 right-0 z-50 h-full w-96 max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col">
    <header class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h2 class="text-sm font-semibold flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
        Bookmarks
      </h2>
      <button
        onclick={() => bookmarkStore.toggleDrawer(false)}
        class="text-muted-foreground hover:text-foreground px-1"
        title="Close"
      >&times;</button>
    </header>

    <div class="flex-1 overflow-y-auto px-3 py-2">
      {#if groups.length === 0}
        <p class="text-xs text-muted-foreground/60 mt-4 text-center">
          No bookmarks yet. Select text in the activity thread and click <em>Bookmark</em>.
        </p>
      {/if}

      {#each groups as repo (repo.repoPath)}
        {@const color = repoColor(repo.repoPath)}
        <div class="mt-3 first:mt-0">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
            {#if color}
              <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background-color: {color}"></span>
            {/if}
            <span class="truncate">{store.repoDisplayName(repo.repoPath)}</span>
          </div>

          {#each repo.sessions as session (session.sessionId)}
            <div class="ml-1 pl-2 border-l border-border/60">
              <div class="text-[11px] text-muted-foreground/70 mb-1 truncate">{session.sessionLabel}</div>

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
                      onkeydown={(e) => { if (e.key === 'Enter') saveNote(b); if (e.key === 'Escape') editingId = null; }}
                      onblur={() => saveNote(b)}
                    />
                  {:else if b.note}
                    <button class="mt-1 text-[11px] text-muted-foreground italic text-left w-full hover:text-foreground" onclick={() => startEdit(b)}>
                      {b.note}
                    </button>
                  {/if}

                  <div class="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onclick={() => jump(b)}
                      class="text-[11px] px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                      title="Jump to source"
                    >Jump</button>
                    {#if editingId !== b.id && !b.note}
                      <button
                        onclick={() => startEdit(b)}
                        class="text-[11px] px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground transition-colors"
                        title="Add note"
                      >Note</button>
                    {/if}
                    <CopyButton text={b.selectedText} class="size-5" />
                    <button
                      onclick={() => bookmarkStore.remove(b.id)}
                      class="ml-auto text-[11px] px-1.5 py-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete bookmark"
                    >Delete</button>
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
