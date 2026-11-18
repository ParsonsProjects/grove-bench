/**
 * Mockup only: puts the agent monitor's trigger (MonitorTrigger.svelte) into
 * the demo app's title bar, before Help, without changing the app's code. A
 * MutationObserver puts it back if the app redraws the title bar. In the app
 * it would simply be in TitleBar.svelte.
 */
import { mount, unmount } from 'svelte';
import MonitorTrigger from './MonitorTrigger.svelte';

/** The button the trigger goes before. */
const ANCHOR = 'button[title="Help (F1)"]';

export function injectTrigger(onopen: () => void): () => void {
  let placed: { anchor: Element; instance: ReturnType<typeof mount> } | null = null;

  function sync() {
    if (placed && !placed.anchor.isConnected) {
      void unmount(placed.instance);
      placed = null;
    }
    if (placed) return;
    const anchor = document.querySelector(ANCHOR);
    if (!anchor?.parentElement) return;
    placed = { anchor, instance: mount(MonitorTrigger, { target: anchor.parentElement, anchor, props: { onopen } }) };
  }

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (placed) void unmount(placed.instance);
  };
}
