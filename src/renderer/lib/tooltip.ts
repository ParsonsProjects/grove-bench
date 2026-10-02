/**
 * App-styled tooltips for plain `title` attributes.
 *
 * Components keep writing `title="..."`. One listener on the document follows
 * the element under the pointer, blanks every `title` Chromium's native tooltip
 * could show for it (an empty title also hides ancestors' titles), and shows a
 * single styled tooltip instead. A title is only put back once the pointer has
 * left it, so the native tooltip never gets a gap to appear in. Keyboard focus
 * shows the same tooltip without blanking anything, since the native one only
 * follows the pointer. Away from the pointer, the DOM (and tests using
 * `getByTitle`) looks the same as before.
 *
 * Styles live in `styles/globals.css` under `.grove-tooltip`.
 */

/**
 * Delay before a tooltip shows when none was showing just before. Long enough
 * that passing over a control on the way somewhere else shows nothing; the
 * same as Bits UI's Tooltip default (`delayDuration`).
 */
export const SHOW_DELAY_MS = 700;
/** After a tooltip hides, the next one within this window shows at once (Bits UI's `skipDelayDuration`). */
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

/** Nearest element with a `title`, SVG elements included. */
export function findTitled(start: EventTarget | null): Element | null {
  return start instanceof Element ? start.closest('[title]') : null;
}

/**
 * The titles Chromium's native tooltip could show when `el` is the nearest
 * titled element. Chromium only reads `title` on HTML elements (an SVG element
 * needs a <title> child), so past an SVG one it falls back to the titled
 * elements above, up to the first HTML one.
 */
export function nativeTitleChain(el: Element | null): Element[] {
  const chain: Element[] = [];
  for (let at = el; at; at = at instanceof HTMLElement ? null : findTitled(at.parentElement)) chain.push(at);
  return chain;
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

  // Titles held blank for the pointer, each with the value to put back (null if it had none).
  const held = new Map<Element, string | null>();
  // Undoes the accessible name or description kept for a held element.
  const a11y = new Map<Element, () => void>();

  // The element under the pointer, and the titled elements the pointer and focus are on.
  let pointerAt: Element | null = null;
  let hoverEl: Element | null = null;
  let focusEl: Element | null = null;
  // The element the tooltip is for: whichever of those two was claimed last.
  let target: Element | null = null;
  let text = '';
  // Hidden by a click, Escape or scroll: stays hidden until another element is claimed.
  let suppressed = false;
  let visible = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let warmUntil = 0;

  const titleOf = (el: Element) => (held.has(el) ? held.get(el) : el.getAttribute('title')) ?? '';

  // Svelte may change or remove a title we hold blank, or add one under the
  // pointer without it moving: follow both.
  const titleObserver = new MutationObserver((records) => {
    let heldChanged = false;
    for (const { target: el } of records) {
      if (!(el instanceof Element) || !held.has(el)) continue;
      const title = el.getAttribute('title');
      if (title === '') continue; // our own blank
      held.set(el, title);
      el.setAttribute('title', '');
      heldChanged = true;
    }
    follow(pointerAt);
    if (target && titleOf(target) !== text) setText(titleOf(target));
    if (heldChanged) settle();
  });
  // An element can be removed without a pointerout or focusout (e.g. its row re-renders).
  const treeObserver = new MutationObserver(() => {
    if (focusEl && !focusEl.isConnected) focusLeft();
    if (pointerAt && !pointerAt.isConnected) follow(pointerAt);
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

  function dismiss() {
    if (!target) return;
    hide();
    suppressed = true;
  }

  /** Point the tooltip at `el`, or at nothing, and start its show delay. */
  function claim(el: Element | null) {
    hide();
    target = el;
    suppressed = false;
    setText(el ? titleOf(el) : '');
    if (!el || !text.trim()) return;
    if (Date.now() < warmUntil) show(true);
    else showTimer = setTimeout(() => show(false), SHOW_DELAY_MS);
  }

  /** Follow the element under the pointer: hold its titles blank and show its tooltip. */
  function follow(at: Element | null) {
    // When the element goes, the pointer is still over its titled ancestor if that stayed.
    if (at && !at.isConnected) at = hoverEl?.isConnected ? hoverEl : null;
    pointerAt = at;
    const el = findTitled(at);
    if (el === hoverEl) return;
    const left = hoverEl;
    hoverEl = el;
    holdChain();
    if (el && el !== target) claim(el);
    else if (!el && target === left && left !== focusEl) claim(null);
    settle();
  }

  function focusLeft() {
    const left = focusEl;
    focusEl = null;
    if (target === left && left !== hoverEl) claim(null);
    settle();
  }

  /** Hold blank each title the native tooltip could show for the pointer; put the rest back. */
  function holdChain() {
    const want = nativeTitleChain(hoverEl);
    for (const el of [...held.keys()]) if (!want.includes(el)) unhold(el);
    for (const el of want) {
      if (held.has(el)) continue;
      held.set(el, el.getAttribute('title'));
      el.setAttribute('title', '');
    }
  }

  function unhold(el: Element) {
    a11y.get(el)?.();
    a11y.delete(el);
    const original = held.get(el) ?? null;
    held.delete(el);
    if (original === null) el.removeAttribute('title');
    else el.setAttribute('title', original);
  }

  /** Re-apply accessible names and descriptions, and watch for removal while anything is tracked. */
  function settle() {
    for (const undo of a11y.values()) undo();
    a11y.clear();
    for (const [el, title] of held) {
      const undo = describe(el, title ?? '');
      if (undo) a11y.set(el, undo);
    }
    if (hoverEl || focusEl) treeObserver.observe(doc.body, { childList: true, subtree: true });
    else treeObserver.disconnect();
  }

  /** Keep a held element's accessible name and description while its title is blank. */
  function describe(el: Element, title: string): (() => void) | null {
    if (!title.trim()) return null;
    const label = el.getAttribute('aria-label');
    const nameless = !label && !el.hasAttribute('aria-labelledby') && !normalize(el.textContent ?? '');
    if (nameless) {
      el.setAttribute('aria-label', title);
      return () => el.removeAttribute('aria-label');
    }
    // The tooltip only holds this element's text while it is the target.
    if (el !== target || (label && normalize(label) === normalize(title))) return null;
    const prev = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', prev ? `${prev} ${tip.id}` : tip.id);
    return () => {
      if (prev === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', prev);
    };
  }

  // Pointer moves catch what pointerover can miss, like a title put back or
  // added while the pointer sat still.
  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') follow(e.target instanceof Element ? e.target : null);
  };

  // relatedTarget is where the pointer went: null when it left the window.
  const onPointerOut = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') follow(e.relatedTarget instanceof Element ? e.relatedTarget : null);
  };

  const onFocusIn = (e: FocusEvent) => {
    const from = e.target;
    if (!(from instanceof Element) || isTextEntry(from) || !isFocusVisible(from)) return;
    const el = findTitled(from);
    if (!el) return;
    focusEl = el;
    if (el !== target) claim(el);
    settle();
  };

  const onFocusOut = (e: FocusEvent) => {
    if (focusEl && e.target instanceof Node && focusEl.contains(e.target)) focusLeft();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };

  const onScroll = (e: Event) => {
    const scroller = e.target;
    if (target && (scroller === doc || (scroller instanceof Node && scroller.contains(target)))) dismiss();
  };

  // Capture phase, so a component stopping propagation can't hide events from us.
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointermove', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  doc.addEventListener('pointerdown', dismiss, true);
  // Covers Enter/Space on a focused control, which fires click without pointerdown.
  doc.addEventListener('click', dismiss, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('scroll', onScroll, true);
  // The titles stay blank: the pointer may still be over them when the window comes back.
  win.addEventListener('blur', dismiss);
  win.addEventListener('resize', dismiss);
  titleObserver.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['title'] });

  return () => {
    hide();
    titleObserver.disconnect();
    treeObserver.disconnect();
    for (const el of [...held.keys()]) unhold(el);
    doc.removeEventListener('pointerover', onPointerOver, true);
    doc.removeEventListener('pointermove', onPointerOver, true);
    doc.removeEventListener('pointerout', onPointerOut, true);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('focusout', onFocusOut, true);
    doc.removeEventListener('pointerdown', dismiss, true);
    doc.removeEventListener('click', dismiss, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', dismiss);
    win.removeEventListener('resize', dismiss);
    tip.remove();
  };
}
