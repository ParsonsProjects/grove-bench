import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import StatusBarPopover from './StatusBarPopover.svelte';

const trigger = createRawSnippet(() => ({ render: () => '<button>Open</button>' }));
const children = createRawSnippet(() => ({ render: () => '<div><button>Inside</button></div>' }));

function renderOpen() {
  render(StatusBarPopover, { open: true, trigger, children, testid: 'panel' });
  return screen.getByTestId('panel');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StatusBarPopover', () => {
  it('closes on a click outside, not on one inside', async () => {
    renderOpen();
    await fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(screen.queryByTestId('panel')).not.toBeNull();

    await fireEvent.click(document.body);
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    renderOpen();
    screen.getByRole('button', { name: 'Inside' }).focus();

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it("leaves Escape alone while its pane is hidden, so the pane on screen gets it", async () => {
    // jsdom has no checkVisibility; a hidden pane's elements report false.
    Element.prototype.checkVisibility = () => false;
    renderOpen();
    const onScreen = vi.fn();
    window.addEventListener('keydown', onScreen);

    try {
      await fireEvent.keyDown(window, { key: 'Escape' });
    } finally {
      window.removeEventListener('keydown', onScreen);
      delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility;
    }

    expect(screen.queryByTestId('panel')).not.toBeNull();
    expect(onScreen).toHaveBeenCalled();
  });

  it('lets Escape through to what has focus elsewhere, such as a dialog opened over it, and closes', async () => {
    renderOpen();
    const finder = document.createElement('input');
    document.body.appendChild(finder);
    finder.focus();
    const finderGotIt = vi.fn();
    finder.addEventListener('keydown', finderGotIt);

    await fireEvent.keyDown(finder, { key: 'Escape' });

    expect(finderGotIt).toHaveBeenCalled();
    expect(document.activeElement).toBe(finder);
    expect(screen.queryByTestId('panel')).toBeNull();
    finder.remove();
  });

  it('slides in when asked to', async () => {
    const realAnimate = Element.prototype.animate;
    const animate = vi.fn(() => ({ onfinish: null, cancel() {}, currentTime: 0 }) as unknown as Animation);
    Element.prototype.animate = animate as never;
    try {
      const { rerender } = render(StatusBarPopover, { open: false, animate: true, trigger, children });
      await rerender({ open: true, animate: true, trigger, children });
      expect(animate).toHaveBeenCalled();
    } finally {
      Element.prototype.animate = realAnimate;
    }
  });
});
