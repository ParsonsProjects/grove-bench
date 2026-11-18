/**
 * Mockup only: puts the agent monitor's trigger (MonitorTrigger.svelte) into
 * the demo app without changing the app's code. One goes before Bookmarks in
 * the sidebar's footer tools (and down the collapsed rail, which shows the
 * same tools), and one before Help in the title bar. Collapsing the sidebar
 * swaps the footer for the rail, so a MutationObserver puts them back
 * whenever the app redraws those parts. In the app they would simply be in
 * Sidebar.svelte's footerTools and in TitleBar.svelte.
 */
import { mount, unmount } from 'svelte';
import MonitorTrigger from './MonitorTrigger.svelte';

/** The buttons the triggers go before. */
const ANCHORS = 'button[title="Bookmarks (Ctrl+B)"], button[title="Help (F1)"]';

export function injectTriggers(onopen: () => void): () => void {
  const mounted: { anchor: Element; instance: ReturnType<typeof mount> }[] = [];

  function sync() {
    for (let i = mounted.length - 1; i >= 0; i--) {
      if (!mounted[i].anchor.isConnected) {
        void unmount(mounted[i].instance);
        mounted.splice(i, 1);
      }
    }
    for (const anchor of document.querySelectorAll(ANCHORS)) {
      const parent = anchor.parentElement;
      if (!parent || mounted.some((m) => m.anchor === anchor)) continue;
      const place = anchor.matches('[title="Help (F1)"]') ? 'titlebar' : parent.classList.contains('flex-col') ? 'rail' : 'footer';
      mounted.push({ anchor, instance: mount(MonitorTrigger, { target: parent, anchor, props: { place, onopen } }) });
    }
  }

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const m of mounted) void unmount(m.instance);
  };
}
