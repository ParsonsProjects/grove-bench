/**
 * The links in a selection, which its text (Selection.toString) leaves out:
 * links it takes text or an image from, to a web page or a file in the
 * thread's worktree, and http(s) addresses written as plain text (tool
 * output, the diff view). A bookmark keeps them (Bookmark.links), and To
 * prompt and Copy write them back into the text (markdownWithLinks,
 * htmlWithLinks).
 */
import type { BookmarkLink } from '../../shared/types.js';
import { localFilePath } from './worktree-files.js';

/** A link in a selection, and its text as the selection shows it: all of
 *  it, or the part a cut leaves. */
export interface FoundLink extends BookmarkLink {
  shown: string;
}

/** The anchors a link can be: MarkdownBlock writes a worktree file's path
 *  in data-local-href, with `#` (or nothing) as its href. */
const ANCHOR = 'a[href], a[data-local-href]';
/** Elements that start a new line: an address never runs across one. */
const BLOCK = 'address, article, blockquote, dd, details, div, dl, dt, figcaption, figure, h1, h2, h3, h4, h5, h6, li, ol, p, pre, section, summary, table, td, th, tr, ul';
const SCHEME = /https?:\/\//gi;
/** What ends an address: a space, a quote or an angle bracket. */
const STOP = /[\s<>"'`]/;
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
/** Punctuation after an address that ends the sentence, not the address:
 *  GFM's rule for its autolinks (`.`, `,`, `:`, `?`, `!`, `*`, `_`, `~`),
 *  and `;`. */
const TRAILING = /[.,;:!?*_~]+$/;
/** Furthest an address cut by the selection is read on past its end. */
const MAX_REST = 2048;

export function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Whether a node in the selection is drawn. Selection.toString leaves out
 *  what isn't (a closed <details>, `hidden`), so its links go too. */
function makeShownCheck(): (node: Node) => boolean {
  const cache = new Map<Element, boolean>();
  const elementShown = (el: Element): boolean => {
    let shown = cache.get(el);
    if (shown !== undefined) return shown;
    // Chromium knows (display, content-visibility); jsdom has no layout.
    shown = typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
    for (let child: Element | null = el; shown && child; child = child.parentElement) {
      const parent = child.parentElement;
      if (child.hasAttribute('hidden')) shown = false;
      // A closed <details> shows only its summary.
      else if (parent?.tagName === 'DETAILS' && !parent.hasAttribute('open') && child.tagName !== 'SUMMARY') shown = false;
    }
    cache.set(el, shown);
    return shown;
  };
  return (node) => {
    const parent = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!parent) return false;
    // Text right inside a closed <details>, outside its summary.
    if (parent !== node && parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) return false;
    return elementShown(parent);
  };
}

/** The link an anchor makes, or null for one that goes nowhere a bookmark
 *  can follow (`#section`, `mailto:`). An image link with no text goes by
 *  the image's alt text. */
function anchorLink(a: Element): BookmarkLink | null {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim()
    || (a.querySelector('img[alt]')?.getAttribute('alt') ?? '').trim();
  const local = a.getAttribute('data-local-href');
  if (local !== null) return localFilePath(local) !== null ? { kind: 'file', href: local, text: text || local } : null;
  const href = a.getAttribute('href');
  return href && /^https?:\/\//i.test(href) ? { kind: 'web', href, text: text || href } : null;
}

/** The text after `offset` in `node` and on through its line, to where an
 *  address would end, for one the selection cuts off. */
function textAfter(node: Text, offset: number, isShown: (node: Node) => boolean): string {
  let rest = node.data.slice(offset);
  const block = node.parentElement?.closest(BLOCK);
  if (!block) return rest;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  for (let next = walker.nextNode(); next && rest.length < MAX_REST && !STOP.test(rest); next = walker.nextNode()) {
    if (next.nodeType === Node.ELEMENT_NODE) {
      if ((next as Element).matches(`br, img, ${ANCHOR}, ${BLOCK}`)) break;
      continue;
    }
    if (!isShown(next)) break;
    rest += (next as Text).data;
  }
  return rest;
}

/** The address that starts at `start` in `text`: up to a space, quote or
 *  angle bracket, or a bracket that closes one opened before it (so the
 *  `)` of `[docs](https://x.dev)` isn't part of it), without the
 *  punctuation that ends a sentence. Empty when it is only the scheme. */
function addressAt(text: string, start: number): { url: string; end: number } {
  const open: Record<string, number> = { '(': 0, '[': 0, '{': 0 };
  let end = start;
  for (; end < text.length; end++) {
    const c = text[end];
    if (STOP.test(c)) break;
    if (c in open) open[c]++;
    else if (c in OPENER) {
      if (open[OPENER[c]] === 0) break;
      open[OPENER[c]]--;
    }
  }
  const url = text.slice(start, end).replace(TRAILING, '');
  return { url: /^https?:\/\/./i.test(url) ? url : '', end };
}

/** The http(s) addresses written in `text`, first to last. */
function addressesIn(text: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (const match of text.matchAll(SCHEME)) {
    // One inside the last address (`?next=https://...`) is part of it.
    if (match.index < from) continue;
    const { url, end } = addressAt(text, match.index);
    from = end;
    if (url) found.push(url);
  }
  return found;
}

/**
 * The links in a selection, first to last: the links it takes text or an
 * image from (each link once, however many of its words it takes), then
 * the addresses written as text outside them. Only what is drawn counts.
 * An address the selection cuts off at its end is read to its end. Reads
 * just the nodes in the range, so a short selection in a long thread is
 * quick.
 */
export function selectionLinks(range: Range): FoundLink[] {
  const root = range.commonAncestorContainer;
  const isShown = makeShownCheck();
  const anchors = new Map<Element, { link: BookmarkLink; shown: string }>();
  // The selection's text outside links, a line per block, for its addresses.
  let plain = '';
  let block: Element | null = null;
  let endsInText = false;
  const newLine = () => {
    if (plain && !plain.endsWith('\n')) plain += '\n';
    block = null;
  };
  const takeAnchor = (a: Element, part: string) => {
    const seen = anchors.get(a);
    if (seen) {
      seen.shown += part;
      return;
    }
    const link = anchorLink(a);
    if (link) anchors.set(a, { link, shown: part });
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = range.startContainer;
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    // Past the end: done.
    if (range.comparePoint(node, 0) > 0) break;
    endsInText = false;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      const start = text === range.startContainer ? range.startOffset : 0;
      const end = text === range.endContainer ? range.endOffset : text.data.length;
      const part = text.data.slice(start, end);
      if (!part || !range.intersectsNode(text) || !isShown(text)) continue;
      const anchor = text.parentElement?.closest(ANCHOR);
      if (anchor) {
        if (part.trim()) takeAnchor(anchor, part);
        // An address in the text never runs into a link's.
        newLine();
        continue;
      }
      const textBlock = text.parentElement?.closest(BLOCK) ?? null;
      if (textBlock !== block) newLine();
      block = textBlock;
      plain += part;
      endsInText = text === range.endContainer;
      continue;
    }
    const el = node as Element;
    if (el.tagName === 'BR') newLine();
    else if (el.tagName === 'IMG' && range.intersectsNode(el) && isShown(el)) {
      const anchor = el.closest(ANCHOR);
      if (anchor) takeAnchor(anchor, '');
    }
  }

  // Cut off at its end: read the address on to where it ends.
  const end = range.endContainer;
  if (endsInText && /https?:\/\/\S*$/i.test(plain) && !/\s/.test((end as Text).data[range.endOffset - 1] ?? ' ')) {
    plain += textAfter(end as Text, range.endOffset, isShown);
  }

  const links: FoundLink[] = [...anchors.values()].map(({ link, shown }) => ({ ...link, shown: shown.replace(/\s+/g, ' ').trim() }));
  for (const url of addressesIn(plain)) links.push({ kind: 'web', href: url, text: url, shown: url });
  return links;
}

/** Where each link's text is in `text`: a piece per run of plain text and
 *  per link placed, and the links whose text it doesn't show (cut, or an
 *  image link) to list after. A link's text matches with any run of
 *  whitespace for its spaces, as the selection's text may lay it out. */
function placeLinks(text: string, links: readonly (BookmarkLink & { shown?: string })[]) {
  const placed: { start: number; end: number; link: BookmarkLink }[] = [];
  const unplaced: BookmarkLink[] = [];
  for (const link of links) {
    const label = (link.shown ?? link.text).trim();
    if (!label) {
      unplaced.push(link);
      continue;
    }
    const pattern = new RegExp(label.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
    let spot: RegExpExecArray | null = null;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const [start, end] = [m.index, m.index + m[0].length];
      if (!placed.some((p) => start < p.end && p.start < end)) {
        spot = m;
        break;
      }
    }
    if (spot) placed.push({ start: spot.index, end: spot.index + spot[0].length, link });
    else unplaced.push(link);
  }
  placed.sort((a, b) => a.start - b.start);
  const pieces: { text: string; link?: BookmarkLink }[] = [];
  let at = 0;
  for (const p of placed) {
    if (p.start > at) pieces.push({ text: text.slice(at, p.start) });
    pieces.push({ text: text.slice(p.start, p.end), link: p.link });
    at = p.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return { pieces, unplaced };
}

/** A Markdown link. An address with a space or bracket goes in `<>`. */
function markdownLink(text: string, href: string): string {
  const label = text.replace(/[[\]\\]/g, '\\$&');
  return `[${label}](${/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href})`;
}

/**
 * `text` with its links written in as Markdown (`[setup guide](https://...)`),
 * for the message box (To prompt) and a copied bookmark. An address that is
 * its own text stays as it is. Links whose text it doesn't show are listed
 * after it. With no links, `text` as it is.
 */
export function markdownWithLinks(text: string, links: readonly (BookmarkLink & { shown?: string })[]): string {
  if (links.length === 0) return text;
  const { pieces, unplaced } = placeLinks(text, links);
  let out = pieces.map((p) => (p.link && p.text !== p.link.href ? markdownLink(p.text, p.link.href) : p.text)).join('');
  const listed = unplaced.filter((l, i) => !out.includes(l.href) && unplaced.findIndex((o) => o.href === l.href) === i);
  if (listed.length > 0) {
    out += `\n\n${listed.map((l) => `- ${l.text === l.href ? l.href : markdownLink(l.text, l.href)}`).join('\n')}`;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * `text` as HTML with its web links as links, for the clipboard beside the
 * plain text (Copy): documents and chat apps paste them as links, as they
 * do from Ctrl+C. A worktree file's path means nothing outside the app, so
 * file links stay text. Web links whose text it doesn't show are listed
 * after it.
 */
export function htmlWithLinks(text: string, links: readonly (BookmarkLink & { shown?: string })[]): string {
  const web = links.filter((l) => l.kind === 'web');
  const { pieces, unplaced } = placeLinks(text, web);
  const anchor = (href: string, label: string) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  let html = pieces.map((p) => (p.link ? anchor(p.link.href, p.text) : escapeHtml(p.text))).join('');
  for (const l of unplaced) html += `<br>${anchor(l.href, l.text)}`;
  return html.replace(/\r?\n/g, '<br>');
}
