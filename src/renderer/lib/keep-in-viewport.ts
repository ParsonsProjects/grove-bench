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
