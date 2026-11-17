/**
 * Images in a thread at full size. The lightbox steps through every image
 * the thread pane has drawn, in the order it draws them, and an image's menu
 * (or the lightbox's buttons) saves a copy to Downloads or shows it in its
 * folder. A thread pane (OutputPanel, SubagentPanel) provides one of these
 * for the thumbnails in it (ImageAttachments) and draws it (ImageLightbox).
 */
import { getContext, setContext } from 'svelte';
import { attachmentImageUrl, worktreeFileUrl } from '../../shared/attachments.js';
import type { ImageSource } from '../../shared/types.js';
import type { ThreadImage } from '../stores/messages.svelte.js';

/** An image as the lightbox and the menu show it. */
export interface ShownImage {
  sessionId: string;
  src: string;
  label: string;
  image: ThreadImage;
}

/** Where an image loads from: its data while the app still has it (just
 *  sent), the saved copy, else the file in the worktree. */
export function imageSrc(sessionId: string, img: ThreadImage): string {
  if ('dataUrl' in img) return img.dataUrl;
  if ('file' in img) return attachmentImageUrl(sessionId, img.file);
  return worktreeFileUrl(sessionId, img.path);
}

export function imageLabel(img: ThreadImage): string {
  return img.name || 'Image';
}

export function shownImage(sessionId: string, img: ThreadImage): ShownImage {
  return { sessionId, src: imageSrc(sessionId, img), label: imageLabel(img), image: img };
}

/** Where main finds an image on disk, or null for inline data that isn't a
 *  base64 data URL. */
export function imageSource(img: ThreadImage): ImageSource | null {
  if ('dataUrl' in img) {
    const url = img.dataUrl;
    const comma = url.indexOf(',');
    const head = comma > 0 ? url.slice(0, comma) : '';
    if (!head.startsWith('data:') || !head.endsWith(';base64')) return null;
    return { kind: 'inline', mediaType: head.slice('data:'.length, -';base64'.length), data: url.slice(comma + 1) };
  }
  if ('file' in img) return img.path ? { kind: 'stored', file: img.file, path: img.path } : { kind: 'stored', file: img.file };
  return { kind: 'worktree', path: img.path };
}

/** A row of thumbnails in the pane: its element (for where it is in the
 *  page) and the images in it that can be opened. */
interface Group {
  el: HTMLElement;
  images: () => ShownImage[];
}

export class ThreadImages {
  #groups = new Set<Group>();
  /** What the open lightbox steps through. Taken when it opens, so images
   *  that come in meanwhile don't move the one showing. */
  list = $state.raw<ShownImage[]>([]);
  index = $state<number | null>(null);
  /** The image menu, where it opened. */
  menu = $state<{ x: number; y: number; image: ShownImage } | null>(null);
  /** What a download or Open file location came to. */
  notice = $state<{ text: string; tone: 'info' | 'danger' } | null>(null);

  get current(): ShownImage | undefined {
    return this.index === null ? undefined : this.list[this.index];
  }

  /** Add a row of thumbnails. Returns the function that takes it out. */
  register(el: HTMLElement, images: () => ShownImage[]): () => void {
    const group = { el, images };
    this.#groups.add(group);
    return () => this.#groups.delete(group);
  }

  /** Open image `i` of the row drawn in `el`, among the images of every row
   *  in the pane, in page order. */
  open(el: HTMLElement, i: number): void {
    const groups = [...this.#groups]
      .filter((g) => g.el.isConnected)
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const all: ShownImage[] = [];
    let at = -1;
    for (const g of groups) {
      if (g.el === el) at = all.length + i;
      all.push(...g.images());
    }
    if (at >= 0 && at < all.length) this.show(all, at);
  }

  /** Open `list` at `index`, without the rows (an image from a list elsewhere). */
  show(list: ShownImage[], index: number): void {
    if (index < 0 || index >= list.length) return;
    this.list = list;
    this.index = index;
  }

  /** The image before or after the one showing. Stops at either end. */
  step(by: 1 | -1): void {
    if (this.index === null) return;
    const next = this.index + by;
    if (next >= 0 && next < this.list.length) this.index = next;
  }

  close(): void {
    this.index = null;
    this.list = [];
  }

  /** Open the image menu at the pointer (or, from the keyboard, under the
   *  element), instead of the thread's own (ActivityContextMenu, which
   *  leaves `[data-thread-image]` alone) or Chromium's. */
  openMenu(e: MouseEvent, image: ShownImage): void {
    e.preventDefault();
    let { clientX: x, clientY: y } = e;
    if (x === 0 && y === 0 && e.currentTarget instanceof Element) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    this.menu = { x, y, image };
  }

  async download(image: ShownImage): Promise<void> {
    const source = imageSource(image.image);
    try {
      const saved = source ? await window.groveBench.downloadImage(image.sessionId, source, image.image.name) : null;
      this.notice = saved
        ? { text: `Saved to Downloads as ${saved}`, tone: 'info' }
        : { text: 'Could not download it: the image is no longer there.', tone: 'danger' };
    } catch (err) {
      console.warn('Could not save the image to Downloads:', err);
      this.notice = { text: 'Could not save the image to Downloads. See the log for details.', tone: 'danger' };
    }
  }

  async showInFolder(image: ShownImage): Promise<void> {
    const source = imageSource(image.image);
    try {
      if (source && (await window.groveBench.showImageInFolder(image.sessionId, source))) return;
      this.notice = { text: 'Could not open its location: the image is no longer there.', tone: 'danger' };
    } catch (err) {
      console.warn('Could not show the image in its folder:', err);
      this.notice = { text: 'Could not open the image\'s location.', tone: 'danger' };
    }
  }
}

const KEY = Symbol('thread-images');

/** Give the thumbnails in this component's pane one lightbox to share. */
export function provideThreadImages(): ThreadImages {
  return setContext(KEY, new ThreadImages());
}

/** The pane's lightbox, if a pane provides one. */
export function threadImages(): ThreadImages | undefined {
  return getContext<ThreadImages | undefined>(KEY);
}
