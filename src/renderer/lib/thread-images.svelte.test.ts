import { describe, it, expect, afterEach } from 'vitest';
import { ThreadImages, imageSource, shownImage } from './thread-images.svelte.js';

const SID = 's1';

afterEach(() => {
  document.body.innerHTML = '';
});

/** A row of thumbnails in the page, registered with `viewer`. */
function row(viewer: ThreadImages, files: string[]): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  viewer.register(el, () => files.map((file) => shownImage(SID, { file })));
  return el;
}

describe('ThreadImages', () => {
  it('opens among every row, in page order, whatever order they registered in', () => {
    const viewer = new ThreadImages();
    const first = document.createElement('div');
    const second = row(viewer, ['c.png']);
    document.body.prepend(first);
    viewer.register(first, () => [shownImage(SID, { file: 'a.png' }), shownImage(SID, { file: 'b.png' })]);

    viewer.open(second, 0);
    expect(viewer.list.map((s) => s.image)).toEqual([{ file: 'a.png' }, { file: 'b.png' }, { file: 'c.png' }]);
    expect(viewer.index).toBe(2);
    expect(viewer.used).toBe(true);
  });

  it('opens nothing for an image its row no longer has', () => {
    const viewer = new ThreadImages();
    row(viewer, ['a.png']);
    const second = row(viewer, ['b.png']);

    viewer.open(second, -1);
    expect(viewer.current).toBeUndefined();
  });

  it('leaves out rows no longer in the page, and stops at either end', () => {
    const viewer = new ThreadImages();
    const gone = row(viewer, ['a.png']);
    const here = row(viewer, ['b.png', 'c.png']);
    gone.remove();

    viewer.open(here, 0);
    expect(viewer.list).toHaveLength(2);
    viewer.step(-1);
    expect(viewer.index).toBe(0);
    viewer.step(1);
    viewer.step(1);
    expect(viewer.index).toBe(1);
  });

  it('forgets which images failed each time it opens', () => {
    const viewer = new ThreadImages();
    const el = row(viewer, ['a.png']);
    viewer.open(el, 0);
    viewer.failed[viewer.current!.src] = true;
    viewer.close();

    viewer.open(el, 0);
    expect(viewer.failed).toEqual({});
  });
});

describe('imageSource', () => {
  it('reads a just-sent image from its base64 data URL', () => {
    expect(imageSource({ name: 'a.png', dataUrl: 'data:image/png;base64,iVBOR' })).toEqual({ kind: 'inline', mediaType: 'image/png', data: 'iVBOR' });
    expect(imageSource({ name: 'a.svg', dataUrl: 'data:image/svg+xml,<svg/>' })).toBeNull();
  });

  it('sends a saved copy by name, with the worktree file it came from', () => {
    expect(imageSource({ file: 'a.png' })).toEqual({ kind: 'stored', file: 'a.png' });
    expect(imageSource({ file: 'a.png', name: 'out/a.png', path: 'out/a.png' })).toEqual({ kind: 'stored', file: 'a.png', path: 'out/a.png' });
    expect(imageSource({ name: 'out/a.svg', path: 'out/a.svg' })).toEqual({ kind: 'worktree', path: 'out/a.svg' });
  });
});
