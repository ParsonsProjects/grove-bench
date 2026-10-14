/** How far to move an element sideways so it sits inside the window with
 *  `margin` px to spare on each side. Negative moves it left. One too wide
 *  to fit lines up with the left margin, so its start stays readable. */
export function viewportShiftX(rect: { left: number; right: number }, viewportWidth: number, margin = 8): number {
  if (rect.right > viewportWidth - margin) {
    return Math.max(viewportWidth - margin - rect.right, margin - rect.left);
  }
  if (rect.left < margin) return margin - rect.left;
  return 0;
}

/** Svelte action for a popover anchored to something in a bar: nudges it
 *  sideways (via margin-left) when it would run past the window edge, and
 *  again when the window is resized while it is open. */
export function keepInViewport(node: HTMLElement, margin = 8) {
  const place = () => {
    // Measure from where the layout puts it, not from the last nudge.
    node.style.marginLeft = '';
    const shift = viewportShiftX(node.getBoundingClientRect(), window.innerWidth, margin);
    if (shift !== 0) node.style.marginLeft = `${shift}px`;
  };
  place();
  window.addEventListener('resize', place);
  return {
    destroy() {
      window.removeEventListener('resize', place);
    },
  };
}

/** The bottom margin that puts a popover `gap` px above the bar it opens
 *  from. It opens above its anchor (bottom: 100%), which sits some way down
 *  inside the bar, so the margin makes up the difference. */
export function marginAboveBar(anchorTop: number, barTop: number, gap = 8): number {
  return Math.max(0, anchorTop - barTop) + gap;
}

/** Svelte action for a popover that opens above the status bar (marked
 *  data-status-bar): lifts it `gap` px clear of the bar's top edge, however
 *  tall the chip it opens from. Measured from its anchor, so a transition on
 *  the popover itself doesn't skew it. Left alone outside such a bar. */
export function aboveBar(node: HTMLElement, gap = 8) {
  const place = () => {
    const bar = node.closest<HTMLElement>('[data-status-bar]');
    const anchor = node.offsetParent;
    if (!bar || !anchor || !bar.contains(anchor)) return;
    const margin = marginAboveBar(anchor.getBoundingClientRect().top, bar.getBoundingClientRect().top, gap);
    node.style.marginBottom = `${margin}px`;
  };
  place();
  window.addEventListener('resize', place);
  return {
    destroy() {
      window.removeEventListener('resize', place);
    },
  };
}

/** Whether a popover that opens below its anchor should open above it
 *  instead: it doesn't fit below but does fit above. Below is the safe side
 *  when it fits neither: a pane scrolls down to what runs past its bottom,
 *  but nothing scrolls up past its top. */
export function opensAbove(
  height: number,
  anchor: { top: number; bottom: number },
  area: { top: number; bottom: number },
  gap = 8,
): boolean {
  return height > area.bottom - anchor.bottom - gap && height <= anchor.top - area.top - gap;
}

/** The nearest ancestor that clips what overflows it. */
function clippingParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** Svelte action for a popover that opens below its anchor (top: 100%,
 *  `gap` px clear of it) in the middle of a scrolling pane. It opens above
 *  instead when opensAbove says so, and moves back below if it later grows
 *  too tall for that (a picker switching tabs, a list loading), where its
 *  top would be cut off. It is kept inside the pane sideways too: no wider
 *  than the pane, and nudged in from its edges. The pane is the nearest
 *  ancestor that clips it, within the window. Placed from its anchor and
 *  its layout size, so a transition on the popover doesn't skew it. */
export function placeInPane(node: HTMLElement, gap = 8) {
  const pane = clippingParent(node);
  /** Which side it opened on, once it has. */
  let above: boolean | null = null;
  const place = () => {
    const style = node.style;
    style.top = style.bottom = style.marginTop = style.marginBottom = style.marginLeft = style.maxWidth = '';
    const anchor = node.offsetParent?.getBoundingClientRect();
    if (!anchor) return;
    const area = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const clip = pane?.getBoundingClientRect();
    if (clip) {
      area.top = Math.max(area.top, clip.top);
      area.bottom = Math.min(area.bottom, clip.bottom);
      area.left = Math.max(area.left, clip.left);
      area.right = Math.min(area.right, clip.right);
    }
    const width = area.right - area.left;
    style.maxWidth = `${width - 2 * gap}px`;
    const rect = node.getBoundingClientRect();
    const shift = viewportShiftX({ left: rect.left - area.left, right: rect.right - area.left }, width, gap);
    if (shift !== 0) style.marginLeft = `${shift}px`;

    const height = node.offsetHeight;
    if (above === null) above = opensAbove(height, anchor, area, gap);
    else if (above && height > anchor.top - area.top - gap) above = false;
    if (above) {
      style.top = 'auto';
      style.bottom = '100%';
      style.marginTop = '0';
      style.marginBottom = `${gap}px`;
    }
  };
  place();
  window.addEventListener('resize', place);
  // Its own size changes too, as its content does. Placing it only moves it.
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
  observer?.observe(node);
  return {
    destroy() {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    },
  };
}
