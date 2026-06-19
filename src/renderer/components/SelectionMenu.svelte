<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { store } from '../stores/sessions.svelte.js';

  // A floating "Bookmark / To prompt" menu shown when the user selects text
  // inside `container`. Works for any scroll container — the activity thread
  // (where selections can anchor to a message via [data-msg-id]) and the diff
  // view (where they become text-only bookmarks).
  let {
    sessionId,
    container,
  }: { sessionId: string; container: HTMLElement | null | undefined } = $props();

  // selAnchor is the raw selection rect; selMenuPos is the clamped on-screen
  // position computed once the menu has rendered (so it never floats off-screen).
  let selAnchor = $state<{ left: number; top: number; bottom: number } | null>(null);
  let selMenuPos = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  let selMenuEl = $state<HTMLDivElement>();
  let pendingSelection: { text: string; msgId: string | null } | null = null;

  function elementOf(node: Node | null): Element | null {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  }

  function clear() {
    selAnchor = null;
    pendingSelection = null;
  }

  function handleSelectionUp() {
    if (store.activeSessionId !== sessionId) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { clear(); return; }
    const text = sel.toString().trim();
    if (!text) { clear(); return; }
    const range = sel.getRangeAt(0);
    if (!container?.contains(range.commonAncestorContainer)) { clear(); return; }
    // Anchor to the message the selection starts in, when there is one (handles
    // multi-message spans). The diff view has no [data-msg-id] → text-only.
    const msgId = elementOf(range.startContainer)?.closest('[data-msg-id]')?.getAttribute('data-msg-id') ?? null;
    pendingSelection = { text, msgId };
    const rect = range.getBoundingClientRect();
    selAnchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
    // Rough initial position; the clamp effect refines it once measured.
    selMenuPos = { left: rect.left, top: Math.max(6, rect.top - 38) };
  }

  // Clamp the menu inside the viewport: prefer above the selection, fall back to
  // below it, and keep it within the left/right edges. Reads measured size after
  // render so it adapts to the menu's actual shape.
  $effect(() => {
    const a = selAnchor;
    const el = selMenuEl;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.min(a.left, window.innerWidth - w - 6);
    if (left < 6) left = 6;
    let top = a.top - h - 6;
    if (top < 6) top = Math.min(a.bottom + 6, window.innerHeight - h - 6);
    if (top < 6) top = 6;
    selMenuPos = { left, top };
  });

  // Watch the container for selections and dismissals. Re-runs when `container`
  // is (re)bound.
  $effect(() => {
    const el = container;
    if (!el) return;
    const onUp = () => handleSelectionUp();
    const onDown = () => { if (selAnchor) clear(); };
    const onScroll = () => { if (selAnchor) clear(); };
    el.addEventListener('mouseup', onUp);
    el.addEventListener('mousedown', onDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('mouseup', onUp);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('scroll', onScroll);
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && selAnchor) clear();
  }

  async function addBookmark() {
    if (!pendingSelection) return;
    const { text, msgId } = pendingSelection;
    let messageUuid: string | null = null;
    let eventIndex: number | null = null;
    if (msgId) {
      const msg = messageStore.getMessages(sessionId).find((m) => m.id === msgId);
      const uuid = (msg && 'uuid' in msg ? (msg as { uuid?: string }).uuid : '') || '';
      messageUuid = uuid || null;
      eventIndex = messageStore.getEventIndexForMessageId(sessionId, msgId);
      if (eventIndex == null && uuid) {
        eventIndex = await window.groveBench.findEventIndexByUuid(sessionId, uuid);
      }
    }
    const session = store.sessions.find((s) => s.id === sessionId);
    await bookmarkStore.add({
      sessionId,
      repoPath: session?.repoPath ?? '',
      sessionLabel: session?.displayName || session?.branch || sessionId,
      messageUuid,
      eventIndex,
      selectedText: text,
    });
    clear();
    window.getSelection()?.removeAllRanges();
  }

  function copyToPrompt() {
    if (!pendingSelection) return;
    // Insert into the (live) prompt input. The prompt is mounted on both the
    // Activity and Changes tabs, so no tab switch is needed.
    messageStore.requestPromptInsert(sessionId, pendingSelection.text);
    clear();
    window.getSelection()?.removeAllRanges();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if selAnchor}
  <div
    bind:this={selMenuEl}
    style="position: fixed; top: {selMenuPos.top}px; left: {selMenuPos.left}px;"
    class="z-50 flex flex-col items-stretch text-xs bg-card border border-border shadow-md"
  >
    <button
      onclick={addBookmark}
      class="flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Bookmark selection"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      Bookmark
    </button>
    <button
      onclick={copyToPrompt}
      class="flex items-center gap-1 px-2 py-1 border-t border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Copy selection to the prompt input"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
      To prompt
    </button>
  </div>
{/if}
