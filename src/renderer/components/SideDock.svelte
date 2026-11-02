<script module lang="ts">
  import { lazyComponent } from '../lib/lazy-component.js';

  const loadSubagentPanel = lazyComponent(() => import('./SubagentPanel.svelte'));
</script>

<script lang="ts">
  /**
   * The dock beside a thread's tabs (stores/dock.svelte): the Focus panel, a
   * subagent's thread or Bookmarks, between the tab bar and the bottom bar,
   * so the status bar and message box stay full width and usable while you
   * read. The Focus panel and a subagent's thread dock in the thread they
   * came from and stay there while another thread is open. Bookmarks, from
   * every thread, docks wherever you are: `bookmarks` says this is the place.
   * Without a `sessionId` (beside the draft or the landing) only Bookmarks
   * can dock here.
   */
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { bookmarkStore } from '../stores/bookmarks.svelte.js';
  import { dockStore, lastOpened, DOCK_MIN_WIDTH, DOCK_THREAD_MIN_WIDTH, type DockPanel } from '../stores/dock.svelte.js';
  import MarkdownPreviewPanel from './MarkdownPreviewPanel.svelte';
  import BookmarksDrawer from './BookmarksDrawer.svelte';

  let { sessionId = null, bookmarks = false }: { sessionId?: string | null; bookmarks?: boolean } = $props();

  let focusHere = $derived(markdownPreviewStore.open && sessionId !== null && markdownPreviewStore.threadId === sessionId);
  let subagentHere = $derived(subagentPanelStore.open && sessionId !== null && subagentPanelStore.sessionId === sessionId);
  let bookmarksHere = $derived(bookmarks && bookmarkStore.drawerOpen);
  let showing = $derived(lastOpened([
    ...(focusHere ? [{ panel: 'focus' as const, opening: markdownPreviewStore.opening }] : []),
    ...(subagentHere ? [{ panel: 'subagent' as const, opening: subagentPanelStore.opening }] : []),
    ...(bookmarksHere ? [{ panel: 'bookmarks' as const, opening: bookmarkStore.opening }] : []),
  ]));

  /** Until dragged: up to 720px for reading (Bookmarks 24rem), never more
   *  than half the room, which leaves about 490px of thread in a 1280px
   *  window with the sidebar open. */
  const DEFAULT_WIDTH: Record<DockPanel, string> = {
    focus: 'min(720px, 50%)',
    subagent: 'min(720px, 50%)',
    bookmarks: 'min(24rem, 50%)',
  };
  let width = $derived.by(() => {
    if (!showing) return undefined;
    const dragged = dockStore.widths[showing];
    return dragged ? `${dragged}px` : DEFAULT_WIDTH[showing];
  });

  let dockEl = $state<HTMLDivElement | null>(null);
  let resizing = $state(false);

  // The drag ends on the button coming up, however it ends: a release this
  // page never hears (over the Preview tab's page, which is a native view,
  // or outside the window) shows on the next move as no button held.
  function startResize(e: PointerEvent) {
    const panel = showing;
    const room = dockEl?.parentElement?.getBoundingClientRect().width;
    if (!panel || !dockEl || !room) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      // No capture (jsdom, or the pointer is already gone): the checks below still end it.
    }
    const startX = e.clientX;
    const startWidth = dockEl.getBoundingClientRect().width;
    const max = Math.max(DOCK_MIN_WIDTH, room - DOCK_THREAD_MIN_WIDTH);
    resizing = true;
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) {
        end();
        return;
      }
      dockStore.setWidth(panel, Math.round(Math.min(max, Math.max(DOCK_MIN_WIDTH, startWidth - (ev.clientX - startX)))));
    };
    const end = () => {
      resizing = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
  }

  /** Panels open here but under the one showing stay mounted, hidden, so
   *  they come back scrolled where they were. */
  function paneClass(panel: DockPanel): string {
    return `${showing === panel ? 'flex' : 'hidden'} flex-1 min-h-0 flex-col`;
  }
</script>

{#if showing}
  <div
    bind:this={dockEl}
    class="relative shrink-0 flex flex-col min-h-0 border-l border-border bg-card"
    style:width
    style:min-width="{DOCK_MIN_WIDTH}px"
    style:max-width="calc(100% - {DOCK_THREAD_MIN_WIDTH}px)"
    data-dock={showing}
  >
    <!-- Drag the left edge to resize. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onpointerdown={startResize}
      class="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-10 -ml-0.5
        {resizing ? 'bg-primary/40' : 'hover:bg-primary/25'} transition-colors"
      title="Drag to resize"
    ></div>
    {#if focusHere}
      <div class={paneClass('focus')}><MarkdownPreviewPanel /></div>
    {/if}
    {#if subagentHere}
      <div class={paneClass('subagent')}>
        {#await loadSubagentPanel() then SubagentPanel}
          <SubagentPanel />
        {/await}
      </div>
    {/if}
    {#if bookmarksHere}
      <div class={paneClass('bookmarks')}><BookmarksDrawer /></div>
    {/if}
  </div>
{/if}
