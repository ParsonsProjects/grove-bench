/**
 * Placing your Preview page. The page is a native view drawn above Grove's
 * HTML, so the panel tells the main process where its content area is and
 * hides the page whenever a Grove menu, dialog or popup overlaps that area.
 */
import type { PreviewBounds } from '../../shared/types.js';

/** Whole CSS pixels, or null for an empty or collapsed box. */
export function toBounds(rect: { left: number; top: number; width: number; height: number }): PreviewBounds | null {
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(rect.left), y: Math.round(rect.top), width, height };
}

export function sameBounds(a: PreviewBounds | null, b: PreviewBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** A grid of points across the box, inset from the edges so borders and
 *  neighbouring elements don't count. */
export function samplePoints(bounds: PreviewBounds, cols = 8, rows = 6, inset = 3): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const w = Math.max(0, bounds.width - inset * 2);
  const h = Math.max(0, bounds.height - inset * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.x + inset + (cols === 1 ? w / 2 : (w * c) / (cols - 1));
      const y = bounds.y + inset + (rows === 1 ? h / 2 : (h * r) / (rows - 1));
      points.push([Math.round(x), Math.round(y)]);
    }
  }
  return points;
}

/**
 * True when something other than `host` (or its children) is on top anywhere
 * on the sampled grid: a dropdown, dialog, popover or toast drawn over the
 * content area. Elements with pointer-events: none aren't hit and don't count.
 */
export function isCovered(
  bounds: PreviewBounds,
  host: Element,
  hitTest: (x: number, y: number) => Element | null,
): boolean {
  for (const [x, y] of samplePoints(bounds)) {
    const el = hitTest(x, y);
    if (el && el !== host && !host.contains(el)) return true;
  }
  return false;
}

/** True when two boxes share any area. */
export function overlaps(a: PreviewBounds, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return b.left < a.x + a.width && b.right > a.x && b.top < a.y + a.height && b.bottom > a.y;
}

/**
 * True when a visible tooltip overlaps the box. Tooltips use
 * pointer-events: none, so the hit test in isCovered can't see them, but they
 * would still be drawn behind the page.
 */
export function tooltipCovers(bounds: PreviewBounds, doc: Document): boolean {
  for (const el of Array.from(doc.querySelectorAll('[role="tooltip"]'))) {
    if ((el as HTMLElement).hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && overlaps(bounds, r)) return true;
  }
  return false;
}
