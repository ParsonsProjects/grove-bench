import { shell, type WebContents } from 'electron';
import { logger } from './logger.js';

/** Whether `target` is the page already loaded at `current` (a reload),
 *  ignoring query and hash. */
export function isSameDocument(target: string, current: string): boolean {
  try {
    const a = new URL(target);
    const b = new URL(current);
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/**
 * Keep the app window on the app's own page. Links the renderer doesn't
 * intercept (a relative link in agent markdown, a middle-click, a file
 * dropped outside the prompt box) would otherwise replace the whole UI, with
 * the preload and its groveBench bridge still attached, or open a bare
 * Electron window. http(s) targets go to the system browser; anything else is
 * dropped.
 */
export function lockToAppPage(wc: WebContents): void {
  const sendOutside = (url: string) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch((e) => logger.warn(`Failed to open ${url} externally:`, e));
    } else {
      logger.warn(`Blocked navigation of the app window to ${url}`);
    }
  };
  wc.on('will-navigate', (event, url) => {
    if (isSameDocument(url, wc.getURL())) return;
    event.preventDefault();
    sendOutside(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    sendOutside(url);
    return { action: 'deny' };
  });
}
