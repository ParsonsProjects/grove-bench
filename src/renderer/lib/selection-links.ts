/**
 * The links in a selection, which its text (Selection.toString) leaves out,
 * for a bookmark to keep (Bookmark.links): links it covers or cuts into, to
 * a web page or a file in the thread's worktree, and http(s) addresses
 * written as plain text (tool output, the diff view).
 */
import type { BookmarkLink } from '../../shared/types.js';
import { localFilePath } from './worktree-files.js';

/** An http(s) address in plain text, up to a space, quote or angle bracket.
 *  Punctuation after it is trimmed (trimAddress). */
const BARE_URL = /https?:\/\/[^\s<>"'`]+/gi;
/** What may follow the selection's end in an address it cut. */
const ADDRESS_REST = /^[^\s<>"'`]*/;

/** The anchors a link can be: MarkdownBlock writes a worktree file's path
 *  in data-local-href, with `#` (or nothing) as its href. */
const ANCHOR = 'a[href], a[data-local-href]';

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Whether the selection takes in some of `node`'s text, not just touches it. */
function takesTextOf(range: Range, node: Node): boolean {
  if (!range.intersectsNode(node)) return false;
  const part = document.createRange();
  part.selectNodeContents(node);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
  return part.toString().trim() !== '';
}

/** The anchors the selection takes text from, first to last. */
function anchorsIn(range: Range): Element[] {
  const root = elementOf(range.commonAncestorContainer);
  if (!root) return [];
  // All of it inside one link.
  const around = root.closest(ANCHOR);
  if (around) return [around];
  return [...root.querySelectorAll(ANCHOR)].filter((a) => takesTextOf(range, a));
}

/** The link an anchor makes, or null for one that goes nowhere a bookmark
 *  can follow (`#section`, `mailto:`). */
function anchorLink(a: Element): BookmarkLink | null {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
  const local = a.getAttribute('data-local-href');
  if (local !== null) return localFilePath(local) !== null ? { kind: 'file', href: local, text: text || local } : null;
  const href = a.getAttribute('href');
  return href && /^https?:\/\//i.test(href) ? { kind: 'web', href, text: text || href } : null;
}

/** An address without the punctuation a sentence puts after it, keeping a
 *  bracket that closes one inside it (`/wiki/Foo_(bar)`). */
function trimAddress(url: string): string {
  let out = url.replace(/[.,;:!?]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (out.endsWith(close) && out.split(open).length < out.split(close).length) {
      out = out.slice(0, -1).replace(/[.,;:!?]+$/, '');
    }
  }
  return out;
}

/** The rest of an address the selection stops part way through: the text
 *  after its end, when that end falls between two characters of a word. */
function addressRest(range: Range): string {
  const node = range.endContainer;
  if (node.nodeType !== Node.TEXT_NODE) return '';
  const data = (node as Text).data;
  const at = range.endOffset;
  if (at === 0 || at >= data.length || /\s/.test(data[at - 1]) || /\s/.test(data[at])) return '';
  return ADDRESS_REST.exec(data.slice(at))![0];
}

/** Addresses written as text in the selection. One the selection cuts off
 *  at its end is read to its end. */
function bareAddresses(range: Range, text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(BARE_URL)) {
    let url = match[0];
    if (match.index + url.length === text.length) url += addressRest(range);
    url = trimAddress(url);
    // Just the scheme: nothing to open.
    if (!/^https?:\/\/./i.test(url)) continue;
    found.push(url);
  }
  return found;
}

/** The links in a selection (`range`, whose text is `text`), first to last:
 *  its links, then the addresses written as text that aren't one of them. */
export function selectionLinks(range: Range, text: string): BookmarkLink[] {
  const links: BookmarkLink[] = [];
  const seen = new Set<string>();
  const add = (link: BookmarkLink) => {
    const key = `${link.kind} ${link.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  for (const a of anchorsIn(range)) {
    const link = anchorLink(a);
    if (link) add(link);
  }
  // A link's own text is in the selection's text too (an autolinked
  // address, or one cut part way): it's already kept, with its full href.
  const inLinks = links.flatMap((l) => [l.href, l.text]);
  for (const url of bareAddresses(range, text)) {
    if (inLinks.some((t) => t.includes(url))) continue;
    add({ kind: 'web', href: url, text: url });
  }
  return links;
}
