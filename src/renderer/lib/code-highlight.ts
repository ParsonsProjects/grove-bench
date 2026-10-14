/**
 * Syntax highlighting for rendered Markdown code blocks and the thread's
 * diffs, done once a block is on screen rather than while its reply renders.
 *
 * Highlighting, and sanitizing the spans it makes, was the largest part of
 * drawing a page of replies: waking a conversation froze the window while
 * every code block in its last 50 messages was coloured at once. Instead
 * MarkdownBlock renders code as plain escaped text with a mark, and this
 * colours each marked block when it comes into view, in idle time, a few at
 * a time. Blocks in a hidden conversation wait until it is shown. DiffView
 * does the same for the edits in a thread (`whenOnScreen`), a slice of lines
 * at a time, since one write can be thousands of lines.
 */
import DOMPurify from 'dompurify';
import hljs from './hljs.js';

/** Marks the code blocks MarkdownBlock left to highlight. Chat content can
 *  include raw HTML; random per launch, so it can't ask for highlighting. */
export const HIGHLIGHT_MARK = crypto.randomUUID();

/** Time to spend per slice when the browser has no idle deadline to give. */
const SLICE_MS = 8;
/** Highlight within this long even if the window never goes idle. */
const IDLE_TIMEOUT_MS = 500;

/**
 * Work to do once its element is on screen, in idle time. It gets the
 * slice's time check and returns true once finished, or false to carry on
 * in a later slice.
 */
export type ScreenJob = (hasTime: () => boolean) => boolean;

/** Jobs whose element is on screen, in the order they came into view. */
const queue = new Map<Element, ScreenJob>();
/** Jobs whose element hasn't come into view yet. */
const waiting = new Map<Element, ScreenJob>();
let scheduled = false;
let observer: IntersectionObserver | null = null;

/** The `<code>` element's language, from the `language-*` class the
 *  renderer gave it. */
function languageOf(code: HTMLElement): string | null {
  return /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? null;
}

/** Colour one marked block in place. Its text is unchanged, so selections,
 *  copy buttons and layout keep working. */
export function highlightBlock(code: HTMLElement): void {
  if (!code.isConnected || code.dataset.hl !== HIGHLIGHT_MARK) return;
  delete code.dataset.hl;
  const language = languageOf(code);
  if (!language || !hljs.getLanguage(language)) return;
  code.innerHTML = DOMPurify.sanitize(hljs.highlight(code.textContent ?? '', { language }).value);
}

function drain(deadline?: IdleDeadline): void {
  scheduled = false;
  const start = performance.now();
  const hasTime = () => (deadline && !deadline.didTimeout
    ? deadline.timeRemaining() > 1
    : performance.now() - start < SLICE_MS);
  // A job that ran out of time goes to the back, so one long diff can't hold
  // up the blocks that came into view after it.
  const unfinished: [Element, ScreenJob][] = [];
  for (const [el, job] of queue) {
    queue.delete(el);
    if (!job(hasTime)) unfinished.push([el, job]);
    if (!hasTime()) break;
  }
  for (const [el, job] of unfinished) queue.set(el, job);
  if (queue.size > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestIdleCallback === 'function') requestIdleCallback(drain, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => drain(), 0);
}

function enqueue(el: Element, job: ScreenJob): void {
  queue.set(el, job);
  schedule();
}

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer?.unobserve(entry.target);
      const job = waiting.get(entry.target);
      waiting.delete(entry.target);
      if (job) enqueue(entry.target, job);
    }
  });
  return observer;
}

/**
 * Run `job` once `el` is on screen, in idle time, a slice at a time until it
 * says it's finished. Returns a function that drops it (call it when `el` is
 * replaced or removed, or the job is out of date).
 */
export function whenOnScreen(el: Element, job: ScreenJob): () => void {
  const io = getObserver();
  if (io) {
    waiting.set(el, job);
    io.observe(el);
  } else {
    enqueue(el, job);
  }
  return () => {
    if (waiting.get(el) === job) {
      waiting.delete(el);
      io?.unobserve(el);
    }
    if (queue.get(el) === job) queue.delete(el);
  };
}

/**
 * Highlight the marked code blocks inside `root` once each is on screen.
 * Returns a function that stops waiting on them (call it when `root`'s
 * content is replaced or removed).
 */
export function highlightWhenVisible(root: HTMLElement): () => void {
  const blocks = [...root.querySelectorAll<HTMLElement>('code[data-hl]')]
    .filter((code) => code.dataset.hl === HIGHLIGHT_MARK);
  if (blocks.length === 0) return () => {};
  const releases = blocks.map((code) => whenOnScreen(code, () => {
    highlightBlock(code);
    return true;
  }));
  return () => {
    for (const release of releases) release();
  };
}
