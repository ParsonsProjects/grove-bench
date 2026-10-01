/**
 * Syntax highlighting for rendered Markdown code blocks, done once a block is
 * on screen rather than while its reply renders.
 *
 * Highlighting, and sanitizing the spans it makes, was the largest part of
 * drawing a page of replies: waking a conversation froze the window while
 * every code block in its last 50 messages was coloured at once. Instead
 * MarkdownBlock renders code as plain escaped text with a mark, and this
 * colours each marked block when it comes into view, in idle time, a few at
 * a time. Blocks in a hidden conversation wait until it is shown.
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

const queue = new Set<HTMLElement>();
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
  for (const code of queue) {
    queue.delete(code);
    highlightBlock(code);
    if (!hasTime()) break;
  }
  if (queue.size > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestIdleCallback === 'function') requestIdleCallback(drain, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => drain(), 0);
}

function enqueue(code: HTMLElement): void {
  queue.add(code);
  schedule();
}

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer?.unobserve(entry.target);
      enqueue(entry.target as HTMLElement);
    }
  });
  return observer;
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
  const io = getObserver();
  for (const code of blocks) {
    if (io) io.observe(code);
    else enqueue(code);
  }
  return () => {
    for (const code of blocks) {
      io?.unobserve(code);
      queue.delete(code);
    }
  };
}
