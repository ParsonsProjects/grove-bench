import { store } from './sessions.svelte.js';
import type { BoardLanes } from '../lib/board.js';

/**
 * The board (alpha, the `boardView` setting): whether the main pane shows it,
 * and how it is laid out. Not saved: the board opens as the list did, with
 * no lanes and no filter, each time the app starts.
 *
 * The board takes the main pane the way the landing does: no thread is open
 * while it shows. Opening a thread from anywhere (a card, the sidebar, the
 * finder) or the draft closes it (App.svelte, draftStore.open).
 */
class BoardStore {
  /** The main pane shows the board. */
  open = $state(false);
  lanes = $state<BoardLanes>('none');
  /** The filter box's text. */
  query = $state('');

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
