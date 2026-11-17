import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import ImageAttachments from './ImageAttachments.svelte';
import Pane from './image-attachments-fixture.svelte';
import type { ThreadImage } from '../stores/messages.svelte.js';

const SID = 's1';
const stored = (c: string, name?: string): ThreadImage => ({ file: `${c.repeat(32)}.png`, ...(name ? { name } : {}) });
const urlOf = (c: string) => `grove-attachment://image/${SID}/${c.repeat(32)}.png`;

// Three rows: two images you attached, a tool's screenshot, and one the
// agent made (a copy, and its file in the worktree).
const ROWS: ThreadImage[][] = [
  [stored('a', 'one.png'), stored('b', 'two.png')],
  [stored('c')],
  [{ file: `${'d'.repeat(32)}.png`, name: 'out/chart.png', path: 'out/chart.png' }],
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function lightboxImage(dialog: HTMLElement): string | null {
  return dialog.querySelector('img')?.getAttribute('src') ?? null;
}

describe('ImageAttachments in a thread pane', () => {
  it('steps through every image in the pane, in order, from the one clicked', async () => {
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.click(screen.getByRole('button', { name: 'View two.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(lightboxImage(dialog)).toBe(urlOf('b'));
    expect(within(dialog).getByTestId('lightbox-position')).toHaveTextContent('2 of 4');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    expect(lightboxImage(dialog)).toBe(urlOf('c'));
    expect(within(dialog).getByTestId('lightbox-position')).toHaveTextContent('3 of 4');

    // The arrow keys too.
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(lightboxImage(dialog)).toBe(urlOf('d'));
    expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeDisabled();
    // Stops at the end.
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(lightboxImage(dialog)).toBe(urlOf('d'));

    // From anywhere: Next, now disabled, dropped the focus to the page.
    await fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(lightboxImage(dialog)).toBe(urlOf('a'));
    expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled();
  });

  it('tries an image that failed to load again the next time it opens', async () => {
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.click(screen.getByRole('button', { name: 'View out/chart.png' }));
    let dialog = await screen.findByRole('dialog');
    await fireEvent.error(dialog.querySelector('img')!);
    expect(within(dialog).getByText('Image not available')).toBeInTheDocument();

    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await fireEvent.click(screen.getByRole('button', { name: 'View out/chart.png' }));
    dialog = await screen.findByRole('dialog');
    expect(lightboxImage(dialog)).toBe(urlOf('d'));
  });

  it('opens one lightbox for the pane, not one per row', async () => {
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.click(screen.getByRole('button', { name: 'View Image' }));
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
  });

  it('skips an image that failed to load', async () => {
    render(Pane, { sessionId: SID, rows: ROWS });
    await fireEvent.error(screen.getByRole('img', { name: 'two.png' }));

    await fireEvent.click(screen.getByRole('button', { name: 'View one.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('lightbox-position')).toHaveTextContent('1 of 3');
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(lightboxImage(dialog)).toBe(urlOf('c'));
  });

  it('downloads a thumbnail from its right-click menu, and says where it went', async () => {
    mockGroveBench.downloadImage.mockResolvedValueOnce('one (1).png');
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View one.png' }), { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu', { name: 'Image actions' });
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download' }));

    expect(mockGroveBench.downloadImage).toHaveBeenCalledWith(SID, { kind: 'stored', file: `${'a'.repeat(32)}.png` }, 'one.png');
    expect(await screen.findByText('Saved to Downloads as one (1).png')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("opens an image's file location from its menu: the agent's own file for one it made", async () => {
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View out/chart.png' }), { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file location' }));

    expect(mockGroveBench.showImageInFolder).toHaveBeenCalledWith(SID, { kind: 'stored', file: `${'d'.repeat(32)}.png`, path: 'out/chart.png' });
  });

  it('says so when the image is gone', async () => {
    mockGroveBench.showImageInFolder.mockResolvedValueOnce(false);
    mockGroveBench.downloadImage.mockResolvedValueOnce(null);
    render(Pane, { sessionId: SID, rows: ROWS });

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View one.png' }), { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file location' }));
    expect(await screen.findByText('Could not open its location: the image is no longer there.')).toBeInTheDocument();

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View one.png' }), { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(await screen.findByText('Could not download it: the image is no longer there.')).toBeInTheDocument();
  });

  it('downloads and shows the open image from the lightbox, or its menu', async () => {
    render(Pane, { sessionId: SID, rows: ROWS });
    await fireEvent.click(screen.getByRole('button', { name: 'View Image' }));
    const dialog = await screen.findByRole('dialog');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(mockGroveBench.downloadImage).toHaveBeenLastCalledWith(SID, { kind: 'stored', file: `${'c'.repeat(32)}.png` }, undefined);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Open file location' }));
    expect(mockGroveBench.showImageInFolder).toHaveBeenLastCalledWith(SID, { kind: 'stored', file: `${'c'.repeat(32)}.png` });

    await fireEvent.contextMenu(dialog.querySelector('img')!, { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(mockGroveBench.downloadImage).toHaveBeenCalledTimes(2);
    // The lightbox stays open.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});

describe('ImageAttachments on its own', () => {
  it('leaves the arrow keys alone while no image is open', async () => {
    render(ImageAttachments, { sessionId: SID, images: ROWS[0] });
    expect(await fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(true);
  });

  it('steps through its own images when no pane shares a lightbox', async () => {
    render(ImageAttachments, { sessionId: SID, images: ROWS[0] });

    await fireEvent.click(screen.getByRole('button', { name: 'View one.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('lightbox-position')).toHaveTextContent('1 of 2');
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(lightboxImage(dialog)).toBe(urlOf('b'));
  });

  it('sends a just-sent image as its data, and a worktree image by its path', async () => {
    render(ImageAttachments, {
      sessionId: SID,
      images: [{ name: 'pasted.png', dataUrl: 'data:image/png;base64,iVBOR' }, { name: 'docs/logo.svg', path: 'docs/logo.svg' }],
    });

    expect(screen.getByRole('img', { name: 'docs/logo.svg' })).toHaveAttribute('src', `grove-attachment://worktree/${SID}/docs%2Flogo.svg`);
    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View pasted.png' }), { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(mockGroveBench.downloadImage).toHaveBeenCalledWith(SID, { kind: 'inline', mediaType: 'image/png', data: 'iVBOR' }, 'pasted.png');

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View docs/logo.svg' }), { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file location' }));
    expect(mockGroveBench.showImageInFolder).toHaveBeenCalledWith(SID, { kind: 'worktree', path: 'docs/logo.svg' });
  });
});
