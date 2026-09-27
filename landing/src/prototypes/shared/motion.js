// Motion helpers shared by the prototypes.
//
// Rule of thumb: content is visible at rest. Animations start from a visible
// state and every loop stops when its element is off-screen, the tab is
// hidden, or the visitor prefers reduced motion.

export { prefersReducedMotion } from 'svelte/motion';

/**
 * Svelte action. Sets `data-inview` on the node while it is on screen and
 * calls `onchange(isVisible)`. It never hides content by itself.
 *
 * @param {HTMLElement} node
 * @param {{ threshold?: number, rootMargin?: string, once?: boolean, onchange?: (visible: boolean) => void }} [options]
 */
export function inView(node, options = {}) {
  let { threshold = 0.15, rootMargin = '0px', once = false, onchange } = options;
  const observer = new IntersectionObserver(
    ([entry]) => {
      node.dataset.inview = String(entry.isIntersecting);
      onchange?.(entry.isIntersecting);
      if (once && entry.isIntersecting) observer.disconnect();
    },
    { threshold, rootMargin },
  );
  observer.observe(node);
  return {
    update(next = {}) {
      onchange = next.onchange;
    },
    destroy: () => observer.disconnect(),
  };
}

/**
 * Runs `tick(dt, t)` on every animation frame while `node` is on screen and
 * the tab is visible. `dt` is in seconds and capped so a resumed loop does not
 * jump. Returns a stop function.
 *
 * @param {Element} node
 * @param {(dt: number, t: number) => void} tick
 */
export function animationLoop(node, tick) {
  let frame = 0;
  let last = 0;
  let onScreen = false;

  const loop = (now) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    tick(dt, now / 1000);
    frame = requestAnimationFrame(loop);
  };

  const sync = () => {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && !frame) {
      last = 0;
      frame = requestAnimationFrame(loop);
    } else if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  observer.observe(node);
  document.addEventListener('visibilitychange', sync);

  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', sync);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}

/**
 * Sizes a canvas to its CSS box at the device pixel ratio and returns the 2D
 * context with the transform set so drawing uses CSS pixels. Call on resize.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [maxRatio]
 */
export function fitCanvas(canvas, maxRatio = 2) {
  const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height, ratio };
}
