import { store } from './sessions.svelte.js';
import { isBoardLanes, isBoardSort, type BoardLanes, type BoardSort } from '../lib/board.js';

/**
 * The board (alpha, the `boardView` setting): whether the main pane shows it,
 * and how it is laid out. Its lanes and sort are saved in app state, so it
 * opens laid out as you left it; the filter isn't, and the board starts
 * closed each time the app starts.
 *
 * The board takes the main pane the way the landing does: no thread is open
 * while it shows. Opening a thread from anywhere (a card, the sidebar, the
 * finder) or the draft closes it (App.svelte, draftStore.open).
 */
class BoardStore {
  /** The main pane shows the board. */
  open = $state(false);
  lanes = $state<BoardLanes>('none');
  /** Order of the thread cards in each column (lib/board.ts: sortBoardThreads). */
  sort = $state<BoardSort>('unread-first');
  /** The filter box's text. */
  query = $state('');

  /** Counts lanes and sort choices, so a choice made while the saved layout
   *  loads isn't undone when it arrives. Plain: nothing draws it. */
  private changes = 0;

  async load(): Promise<void> {
    const before = this.changes;
    try {
      const saved = await window.groveBench.getBoardLayout();
      if (!saved || this.changes !== before) return;
      if (isBoardLanes(saved.lanes)) this.lanes = saved.lanes;
      if (isBoardSort(saved.sort)) this.sort = saved.sort;
    } catch (e) {
      console.error('Failed to load the board layout:', e);
    }
  }

  setLanes(lanes: BoardLanes): void {
    this.lanes = lanes;
    this.save();
  }

  setSort(sort: BoardSort): void {
    this.sort = sort;
    this.save();
  }

  private save(): void {
    this.changes++;
    window.groveBench.setBoardLayout({ lanes: this.lanes, sort: this.sort });
  }

  /** The thread that was open when the board opened, to go back to from
   *  List. Plain: nothing draws it. */
  private returnTo: string | null = null;

  show(): void {
    if (this.open) return;
    this.returnTo = store.activeSessionId;
    this.open = true;
    store.activeSessionId = null;
  }

  /** Back to the list, and to the thread that was open before the board if
   *  it still is (closed meanwhile, it stays closed). */
  showList(): void {
    if (!this.open) return;
    const back = store.sessions.find((s) => s.id === this.returnTo);
    this.close();
    if (back && store.isOpenTab(back)) store.activeSessionId = back.id;
  }

  /** Something else took the main pane: the board closes without going back. */
  close(): void {
    this.open = false;
    this.returnTo = null;
  }

  /** Open a card's thread. */
  openThread(id: string): void {
    this.close();
    store.activeSessionId = id;
    store.clearNeedsAttention(id);
  }
}

export const boardStore = new BoardStore();
