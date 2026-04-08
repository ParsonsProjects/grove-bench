/** Pixel amount to scroll when clicking an arrow button. */
export const SCROLL_AMOUNT = 200;

/** Whether the container can scroll further left. */
export function canScrollLeft(container: HTMLElement): boolean {
  return container.scrollLeft > 0;
}

/** Whether the container can scroll further right. */
export function canScrollRight(container: HTMLElement): boolean {
  return Math.ceil(container.scrollLeft) + container.clientWidth < container.scrollWidth;
}

/** Smoothly scroll the container so the given tab is fully visible. */
export function scrollToTab(container: HTMLElement, tab: HTMLElement): void {
  const tabLeft = tab.offsetLeft;
  const tabRight = tabLeft + tab.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;

  if (tabRight > viewRight) {
    container.scrollTo({ left: tabRight - container.clientWidth, behavior: 'smooth' });
  } else if (tabLeft < viewLeft) {
    container.scrollTo({ left: tabLeft, behavior: 'smooth' });
  }
}

/** Scroll the container left or right by SCROLL_AMOUNT. */
export function scrollByAmount(container: HTMLElement, direction: 'left' | 'right'): void {
  const delta = direction === 'right' ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
  container.scrollTo({ left: container.scrollLeft + delta, behavior: 'smooth' });
}
