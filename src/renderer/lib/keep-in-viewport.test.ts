import { describe, it, expect, afterEach, vi } from 'vitest';
import { viewportShiftX, keepInViewport } from './keep-in-viewport.js';

describe('viewportShiftX', () => {
  it('leaves an element that fits where it is', () => {
    expect(viewportShiftX({ left: 100, right: 484 }, 1440)).toBe(0);
  });

  it('moves one that runs past the right edge back inside the margin', () => {
    // 384px popover starting at 900 in a 1100px window: 184px over, plus 8.
    expect(viewportShiftX({ left: 900, right: 1284 }, 1100)).toBe(-192);
  });

  it('moves one that starts left of the window to the margin', () => {
    expect(viewportShiftX({ left: -20, right: 300 }, 1100)).toBe(28);
  });

  it('keeps the start of one wider than the window visible', () => {
    expect(viewportShiftX({ left: 300, right: 1300 }, 800)).toBe(-292);
  });
});

describe('keepInViewport', () => {
  afterEach(() => vi.restoreAllMocks());

  function popover(left: number, width: number) {
    const node = document.createElement('div');
    vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
      const shift = parseFloat(node.style.marginLeft || '0');
      return { left: left + shift, right: left + width + shift } as DOMRect;
    });
    return node;
  }

  it('nudges the node when it opens and again on resize', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1100);
    const node = popover(900, 384);
    const action = keepInViewport(node);
    expect(node.style.marginLeft).toBe('-192px');

    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    window.dispatchEvent(new Event('resize'));
    expect(node.style.marginLeft).toBe('');

    action.destroy();
  });
});
