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
 *  instead: it would run past the bottom of the area it shows in, and there
 *  is more room above the anchor than below. */
export function opensAbove(
  height: number,
  anchor: { top: number; bottom: number },
  area: { top: number; bottom: number },
  gap = 8,
): boolean {
  const below = area.bottom - anchor.bottom - gap;
  const above = anchor.top - area.top - gap;
  return height > below && above > below;
}

/** The nearest ancestor that clips what overflows it. */
function clippingParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** Svelte action for a popover that opens below its anchor (top: 100%,
 *  `gap` px clear of it) in the middle of a pane: opens it above instead
 *  when it wouldn't fit below and there is more room above (opensAbove).
 *  The area is the window, cut to the nearest ancestor that would clip it.
 *  Measured from its anchor and its layout height, so a transition on the
 *  popover itself doesn't skew it. */
export function flipToFit(node: HTMLElement, gap = 8) {
  const place = () => {
    node.style.top = node.style.bottom = node.style.marginTop = node.style.marginBottom = '';
    const anchor = node.offsetParent;
    if (!anchor) return;
    const area = { top: 0, bottom: window.innerHeight };
    const clip = clippingParent(node)?.getBoundingClientRect();
    if (clip) {
      area.top = Math.max(area.top, clip.top);
      area.bottom = Math.min(area.bottom, clip.bottom);
    }
    if (opensAbove(node.offsetHeight, anchor.getBoundingClientRect(), area, gap)) {
      node.style.top = 'auto';
      node.style.bottom = '100%';
      node.style.marginTop = '0';
      node.style.marginBottom = `${gap}px`;
    }
  };
  place();
  window.addEventListener('resize', place);
  return {
    destroy() {
      window.removeEventListener('resize', place);
    },
  };
}
