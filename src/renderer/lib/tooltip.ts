/**
 * App-styled tooltips for plain `title` attributes.
 *
 * Components keep writing `title="..."`. One listener on the document picks up
 * the element under the pointer (or focused from the keyboard), blanks its
 * `title` so Chromium's native tooltip never appears (an empty title also hides
 * ancestors' titles), and shows a single styled tooltip instead. The `title` is
 * put back when the pointer and focus leave, so the DOM (and tests using
 * `getByTitle`) look the same as before whenever no tooltip is showing.
 *
 * Styles live in `styles/globals.css` under `.grove-tooltip`.
 */

/** Delay before a tooltip shows when none was showing just before. */
export const SHOW_DELAY_MS = 300;
/** After a tooltip hides, the next one within this window shows at once. */
export const WARM_WINDOW_MS = 300;

const GAP_PX = 4;
const EDGE_PX = 4;

export type TooltipSide = 'top' | 'bottom';

interface Box { left: number; top: number; width: number; height: number }
interface Size { width: number; height: number }

/**
 * Put the tooltip under the target, or above it when it doesn't fit below.
 * Centred on the target and kept inside the viewport.
 */
export function placeTooltip(target: Box, tip: Size, viewport: Size): { x: number; y: number; side: TooltipSide } {
  const below = target.top + target.height + GAP_PX;
  const above = target.top - GAP_PX - tip.height;
  const roomBelow = viewport.height - EDGE_PX - below;
  const roomAbove = above - EDGE_PX;
  const side: TooltipSide = roomBelow >= tip.height || roomBelow >= roomAbove ? 'bottom' : 'top';
  const y = side === 'bottom' ? below : above;
  const centred = target.left + target.width / 2 - tip.width / 2;
  const x = Math.max(EDGE_PX, Math.min(centred, viewport.width - EDGE_PX - tip.width));
  return { x: Math.round(x), y: Math.round(y), side };
}

/** Nearest element with a `title`, as the native tooltip picks it. */
export function findTitled(start: EventTarget | null): Element | null {
  return start instanceof Element ? start.closest('[title]') : null;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * A truncated element whose text fits and already shows the whole title gains
 * nothing from a tooltip. Anything not truncated with an ellipsis always shows.
 */
export function isRedundant(el: Element, text: string): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view || view.getComputedStyle(el).textOverflow !== 'ellipsis') return false;
  if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) return false;
  return normalize(el.textContent ?? '').includes(normalize(text));
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Focus tooltips would cover what the user is typing, so text fields skip them. */
function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

function defaultFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export interface TooltipOptions {
  /** Whether a focused element should show its tooltip. Tests override this. */
  isFocusVisible?: (el: Element) => boolean;
}

/** Install the tooltip layer on `doc`. Returns an uninstall function. */
export function installTooltips(doc: Document = document, options: TooltipOptions = {}): () => void {
  const win = doc.defaultView!;
  const isFocusVisible = options.isFocusVisible ?? defaultFocusVisible;

  const tip = doc.createElement('div');
  tip.id = 'grove-tooltip';
  tip.className = 'grove-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.appendChild(tip);

  // The claimed element: it holds title="" and the tooltip shows `original`.
  let target: Element | null = null;
  // Its real title, restored on release (null if Svelte removed it meanwhile).
  let original: string | null = null;
  let text = '';
  let hovered = false;
  let focused = false;
  // Hidden by a click, Escape or scroll: stays hidden until another element is claimed.
  let suppressed = false;
  let visible = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let warmUntil = 0;
  let undoA11y: (() => void) | null = null;

  // Svelte may change or remove the title while we hold it blank: follow it.
  const titleObserver = new MutationObserver(() => {
    if (!target) return;
    const title = target.getAttribute('title');
    if (title === '') return; // our own blank
    original = title;
    setText(title ?? '');
    target.setAttribute('title', '');
    undoA11y?.();
    undoA11y = describe(target);
  });
  // The element can be removed without a pointerout (e.g. its row re-renders).
  const treeObserver = new MutationObserver(() => {
    if (target && !target.isConnected) release();
  });

  function setText(next: string) {
    text = next;
    tip.textContent = next;
    if (!next.trim()) hide();
    else if (visible) position();
  }

  function position() {
    if (!target) return;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const { x, y, side } = placeTooltip(r, t, { width: win.innerWidth, height: win.innerHeight });
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.dataset.side = side;
  }

  function show(instant: boolean) {
    showTimer = undefined;
    if (!target || suppressed || !text.trim() || isRedundant(target, text)) return;
    tip.toggleAttribute('data-instant', instant);
    tip.hidden = false;
    visible = true;
    position();
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!visible) return;
    visible = false;
    tip.hidden = true;
    warmUntil = Date.now() + WARM_WINDOW_MS;
  }

  /** Keep the element's accessible name and description while its title is blank. */
  function describe(el: Element): () => void {
    if (!text.trim()) return () => {};
    const label = el.getAttribute('aria-label');
    const nameless = !label && !el.hasAttribute('aria-labelledby') && !normalize(el.textContent ?? '');
    if (nameless) {
      el.setAttribute('aria-label', text);
      return () => el.removeAttribute('aria-label');
    }
    if (label && normalize(label) === normalize(text)) return () => {};
    const prev = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', prev ? `${prev} ${tip.id}` : tip.id);
    return () => {
      if (prev === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', prev);
    };
  }

  function claim(el: Element, via: 'pointer' | 'focus') {
    const title = el.getAttribute('title') ?? '';
    release();
    // An empty title hides ancestors' tooltips natively; show nothing for it either.
    if (!title.trim()) return;
    target = el;
    original = title;
    hovered = via === 'pointer';
    focused = via === 'focus';
    suppressed = false;
    el.setAttribute('title', '');
    setText(title);
    undoA11y = describe(el);
    titleObserver.observe(el, { attributes: true, attributeFilter: ['title'] });
    treeObserver.observe(doc.body, { childList: true, subtree: true });
    if (Date.now() < warmUntil) show(true);
    else showTimer = setTimeout(() => show(false), SHOW_DELAY_MS);
  }

  function release() {
    hide();
    if (!target) return;
    // Disconnect first: it drops queued records, so restoring below isn't seen as an update.
    titleObserver.disconnect();
    treeObserver.disconnect();
    undoA11y?.();
    undoA11y = null;
    if (original === null) target.removeAttribute('title');
    else target.setAttribute('title', original);
    target = null;
    original = null;
    hovered = focused = suppressed = false;
  }

  function dismiss() {
    if (!target) return;
    hide();
    suppressed = true;
  }

  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = findTitled(e.target);
    if (!el) return;
    if (el === target) hovered = true;
    else claim(el, 'pointer');
  };

  const onPointerOut = (e: PointerEvent) => {
    if (!target || !hovered) return;
    const to = e.relatedTarget;
    if (to instanceof Node && target.contains(to)) return;
    hovered = false;
    if (!focused) release();
  };

  const onFocusIn = (e: FocusEvent) => {
    const from = e.target;
    if (!(from instanceof Element) || isTextEntry(from) || !isFocusVisible(from)) return;
    const el = findTitled(from);
    if (!el) return;
    if (el === target) focused = true;
    else claim(el, 'focus');
  };

  const onFocusOut = (e: FocusEvent) => {
    if (!target || findTitled(e.target) !== target) return;
    focused = false;
    if (!hovered) release();
  };

  const onPointerDown = () => {
    // Keep a hovered element claimed so the native tooltip can't show after the click.
    if (hovered) dismiss();
    else release();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };

  const onScroll = (e: Event) => {
    const scroller = e.target;
    if (target && (scroller === doc || (scroller instanceof Node && scroller.contains(target)))) dismiss();
  };

  const onBlur = () => release();

  doc.addEventListener('pointerover', onPointerOver);
  doc.addEventListener('pointerout', onPointerOut);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onPointerDown, true);
  // Covers Enter/Space on a focused control, which fires click without pointerdown.
  doc.addEventListener('click', dismiss, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('scroll', onScroll, true);
  win.addEventListener('blur', onBlur);
  win.addEventListener('resize', dismiss);

  return () => {
    release();
    doc.removeEventListener('pointerover', onPointerOver);
    doc.removeEventListener('pointerout', onPointerOut);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('click', dismiss, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('resize', dismiss);
    tip.remove();
  };
}
