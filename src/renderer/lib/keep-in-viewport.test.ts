import { describe, it, expect, afterEach, vi } from 'vitest';
import { viewportShiftX, keepInViewport, marginAboveBar, aboveBar } from './keep-in-viewport.js';

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

describe('marginAboveBar', () => {
  it('makes up the distance from the bar to the anchor, plus the gap', () => {
    // A two-line stack starting 8px into a bar at 748.
    expect(marginAboveBar(756, 748)).toBe(16);
    // A one-line chip starting 18px in.
    expect(marginAboveBar(766, 748, 8)).toBe(26);
  });

  it('never pulls a popover down into the bar', () => {
    expect(marginAboveBar(700, 748)).toBe(8);
  });
});

describe('aboveBar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** A popover in an anchor in a bar. jsdom has no layout, so the tops and
   *  the popover's offsetParent (its anchor) are stubbed. */
  function popoverIn(barTop: number, anchorTop: number, { marked = true } = {}) {
    const bar = document.createElement('div');
    if (marked) bar.setAttribute('data-status-bar', '');
    const anchor = document.createElement('div');
    const node = document.createElement('div');
    anchor.append(node);
    bar.append(anchor);
    document.body.append(bar);
    vi.spyOn(bar, 'getBoundingClientRect').mockImplementation(() => ({ top: barTop }) as DOMRect);
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ top: anchorTop }) as DOMRect);
    Object.defineProperty(node, 'offsetParent', { get: () => anchor });
    return { bar, node };
  }

  it("lifts the popover clear of the bar's top edge", () => {
    const { node } = popoverIn(748, 766);
    const action = aboveBar(node);
    expect(node.style.marginBottom).toBe('26px');
    action.destroy();
  });

  it('measures again when the window is resized', () => {
    const { bar, node } = popoverIn(748, 766);
    const action = aboveBar(node);
    vi.spyOn(bar, 'getBoundingClientRect').mockImplementation(() => ({ top: 760 }) as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(node.style.marginBottom).toBe('14px');
    action.destroy();
  });

  it('leaves a popover outside the status bar alone', () => {
    const { node } = popoverIn(748, 766, { marked: false });
    aboveBar(node).destroy();
    expect(node.style.marginBottom).toBe('');
  });
});
