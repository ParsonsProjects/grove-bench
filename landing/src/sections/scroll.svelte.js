// Scroll position shared by the page: how far down it is (0 to 1), and the
// time of day that maps to, from 08:00 at the top to 22:00 at the bottom.

export const scroll = $state({ y: 0, progress: 0, vh: 800, moving: false });

let started = false;
let stopTimer = 0;

export function trackScroll() {
  if (started) return () => {};
  started = true;
  let queued = false;
  const read = () => {
    queued = false;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scroll.y = window.scrollY;
    scroll.vh = window.innerHeight;
    scroll.progress = Math.min(1, Math.max(0, window.scrollY / max));
  };
  const onScroll = () => {
    scroll.moving = true;
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => (scroll.moving = false), 160);
    if (!queued) {
      queued = true;
      requestAnimationFrame(read);
    }
  };
  read();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  return () => {
    started = false;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}

/** Minutes since midnight for a scroll progress. */
export const minutesAt = (p) => 8 * 60 + p * 14 * 60;

export function clockText(p) {
  const m = Math.round(minutesAt(p) / 5) * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** After sunset (about 19:30) the page is at dusk or night. */
export const isEvening = (p) => minutesAt(p) >= 19.5 * 60;

/**
 * Svelte action: adds `in` once the element is a little way into the
 * viewport, and calls `onenter`. Marks the page so CSS may hide `.rise`
 * elements until then (they stay visible without JavaScript).
 */
export function arrive(node, { onenter, margin = '-12% 0px -12% 0px', once = true } = {}) {
  document.documentElement.classList.add('js-motion');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.classList.add('in');
    onenter?.(true);
    return {};
  }
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) {
        node.classList.add('in');
        onenter?.(false);
        if (once) io.disconnect();
      }
    },
    { rootMargin: margin },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}
