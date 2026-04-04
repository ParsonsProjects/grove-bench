import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canScrollLeft, canScrollRight, scrollToTab, scrollByAmount, SCROLL_AMOUNT } from './tab-scroll.js';

function mockContainer(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    scrollLeft: 0,
    scrollWidth: 500,
    clientWidth: 300,
    scrollTo: vi.fn(),
    ...overrides,
  } as unknown as HTMLElement;
}

function mockTab(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    offsetLeft: 100,
    offsetWidth: 80,
    ...overrides,
  } as unknown as HTMLElement;
}

describe('canScrollLeft', () => {
  it('returns false when scrolled to start', () => {
    expect(canScrollLeft(mockContainer({ scrollLeft: 0 }))).toBe(false);
  });

  it('returns true when scrolled past start', () => {
    expect(canScrollLeft(mockContainer({ scrollLeft: 10 }))).toBe(true);
  });
});

describe('canScrollRight', () => {
  it('returns false when scrolled to end', () => {
    const el = mockContainer({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 });
    expect(canScrollRight(el)).toBe(false);
  });

  it('returns true when more content to the right', () => {
    const el = mockContainer({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 });
    expect(canScrollRight(el)).toBe(true);
  });

  it('returns false when content fits without scrolling', () => {
    const el = mockContainer({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 });
    expect(canScrollRight(el)).toBe(false);
  });
});

describe('scrollToTab', () => {
  it('scrolls right when tab is past the right edge', () => {
    const container = mockContainer({ scrollLeft: 0, clientWidth: 300 });
    // Tab at offsetLeft 350, width 80 → right edge at 430, past container's 300
    const tab = mockTab({ offsetLeft: 350, offsetWidth: 80 });

    scrollToTab(container, tab);

    expect(container.scrollTo).toHaveBeenCalledWith({
      left: 130, // (350 + 80) - 300 = 130
      behavior: 'smooth',
    });
  });

  it('scrolls left when tab is before the left edge', () => {
    const container = mockContainer({ scrollLeft: 200, clientWidth: 300 });
    // Tab at offsetLeft 100, which is before scrollLeft 200
    const tab = mockTab({ offsetLeft: 100, offsetWidth: 80 });

    scrollToTab(container, tab);

    expect(container.scrollTo).toHaveBeenCalledWith({
      left: 100,
      behavior: 'smooth',
    });
  });

  it('does not scroll when tab is fully visible', () => {
    const container = mockContainer({ scrollLeft: 50, clientWidth: 300 });
    // Tab at 100, width 80 → fully within [50, 350]
    const tab = mockTab({ offsetLeft: 100, offsetWidth: 80 });

    scrollToTab(container, tab);

    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});

describe('scrollByAmount', () => {
  it('scrolls right by SCROLL_AMOUNT', () => {
    const container = mockContainer({ scrollLeft: 0 });

    scrollByAmount(container, 'right');

    expect(container.scrollTo).toHaveBeenCalledWith({
      left: SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  });

  it('scrolls left by SCROLL_AMOUNT', () => {
    const container = mockContainer({ scrollLeft: 300 });

    scrollByAmount(container, 'left');

    expect(container.scrollTo).toHaveBeenCalledWith({
      left: 300 - SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  });
});
