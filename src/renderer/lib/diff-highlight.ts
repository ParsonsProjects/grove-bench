import hljs from './hljs.js';
import DOMPurify from 'dompurify';
import { diffWordsWithSpace } from 'diff';
import type { DiffLine } from './diff-types.js';
import type { ToolView } from '../../shared/tool-view.js';

/** Map of file extensions to highlight.js language ids. */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', xml: 'xml', svelte: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', kt: 'kotlin', swift: 'swift', dart: 'dart',
};

/** Resolve a highlight.js language id for a file path, or null if unknown/unsupported. */
export function languageForPath(filePath: string): string | null {
  const m = filePath.match(/\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  const lang = EXT_TO_LANG[m[1].toLowerCase()];
  return lang && hljs.getLanguage(lang) ? lang : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Return sanitized HTML for a line of code. When a language is given, highlight.js
 * token spans are produced and run through DOMPurify; otherwise the text is HTML-escaped.
 * Either way the result is safe to inject with {@html} — embedded markup is inert.
 */
export function highlightLine(text: string, lang: string | null): string {
  if (!lang) return escapeHtml(text);
  return highlightCache.get(`${lang}\n${text}`, () => renderLine(text, lang));
}

/**
 * `highlightLine` without the shared cache, for a caller that keeps its own
 * results (DiffView's thread diffs), so a long diff in the thread can't push
 * out the lines the Changes panel redraws on every refresh.
 */
export function highlightLineUncached(text: string, lang: string | null): string {
  return lang ? renderLine(text, lang) : escapeHtml(text);
}

/** Longer lines (minified code) stay plain in a diff DiffView colours in idle
 *  time: one can take highlight.js longer than any idle slice. Word marks
 *  stop at the same length (intralineRanges). */
export const MAX_DEFERRED_LINE = 2000;
/** Such a diff with more distinct lines than this stays plain, which bounds
 *  the work and memory one diff in the thread can take. The Changes and
 *  Checkpoints panels colour a diff in full unless it is large (below),
 *  when these limits apply there too. */
export const MAX_DEFERRED_LINES = 5000;
/** A diff with more code lines or characters than these waits for "Show
 *  diff" in the Changes and Checkpoints panels, then colours in idle time.
 *  Drawn at once it stalls the window: in Chromium, 5,000 lines took about a
 *  second to colour and lay out, and one changed line of minified code can
 *  be megabytes. Edit History, the thread and the permission prompt apply
 *  them to an edit (quickEditDiff). Check them with isLargeDiff, not by
 *  hand. */
export const LARGE_DIFF_LINES = 2000;
export const LARGE_DIFF_CHARS = 100_000;

/** Whether a diff of this many code lines and characters waits for "Show diff". */
export function isLargeDiff(size: { lines: number; chars: number }): boolean {
  return size.lines > LARGE_DIFF_LINES || size.chars > LARGE_DIFF_CHARS;
}

/** A diff's code lines and characters, hunk headers aside, for isLargeDiff. */
export function diffSize(lines: DiffLine[]): { lines: number; chars: number } {
  let count = 0;
  let chars = 0;
  for (const l of lines) {
    if (l.type === 'hunk') continue;
    count++;
    chars += l.text.length;
  }
  return { lines: count, chars };
}

/** How much text an edit call carries: both sides of each replacement, or
 *  the whole write. Over the limits, quickEditDiff diffs it with capped
 *  effort first: createPatch slows down with how much changed, to seconds
 *  for a heavy change to a large file. */
export function editSize(view: ToolView): { lines: number; chars: number } {
  const texts = view.edits?.length ? view.edits.flatMap((e) => [e.oldText, e.newText]) : [view.write ?? ''];
  let lines = 0;
  let chars = 0;
  for (const t of texts) {
    if (!t) continue;
    chars += t.length;
    lines++;
    for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) lines++;
    // A final newline ends the last line rather than starting another.
    if (t.endsWith('\n')) lines--;
  }
  return { lines, chars };
}

/**
 * The distinct code lines DiffView colours in idle time (deferHighlight), or
 * null when the diff has too many to colour at all.
 */
export function linesToColour(lines: DiffLine[]): Set<string> | null {
  const texts = new Set<string>();
  for (const l of lines) {
    if ((l.type === 'add' || l.type === 'del' || l.type === 'context') && l.text.length <= MAX_DEFERRED_LINE) texts.add(l.text);
  }
  return texts.size > MAX_DEFERRED_LINES ? null : texts;
}

function renderLine(text: string, lang: string): string {
  try {
    return DOMPurify.sanitize(hljs.highlight(text, { language: lang }).value);
  } catch {
    return escapeHtml(text);
  }
}

/**
 * A Map that keeps the `max` most recently used entries. When full it drops
 * the least recently used tenth, rather than everything: clearing it all
 * meant a diff longer than the cache was worked out in full on every render.
 */
export class RecentCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      // Most recent last (a Map keeps insertion order).
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = make();
    if (this.map.size >= this.max) {
      let drop = Math.max(1, Math.floor(this.max / 10));
      for (const k of this.map.keys()) {
        this.map.delete(k);
        if (--drop === 0) break;
      }
    }
    this.map.set(key, value);
    return value;
  }

  get size(): number { return this.map.size; }
}

/** DiffView calls highlightLine for every line on every re-render of the
 *  diff, and each call builds a DOMPurify document. Lines are unchanged
 *  across re-renders (and repeat across files), so memoize by (lang, text). */
const highlightCache = new RecentCache<string>(20_000);
/** Word-level marks go through a DOM template per line; same idea. */
const markCache = new RecentCache<string>(5_000);

export interface WordSegment { text: string; changed: boolean; }

/**
 * Split a changed del/add line pair into word-level segments, marking which words changed.
 * Uses diffWordsWithSpace so whitespace is preserved.
 */
export function wordDiffSegments(oldText: string, newText: string): { del: WordSegment[]; add: WordSegment[] } {
  const parts = diffWordsWithSpace(oldText, newText);
  const del: WordSegment[] = [];
  const add: WordSegment[] = [];
  for (const p of parts) {
    if (p.added) {
      add.push({ text: p.value, changed: true });
    } else if (p.removed) {
      del.push({ text: p.value, changed: true });
    } else {
      del.push({ text: p.value, changed: false });
      add.push({ text: p.value, changed: false });
    }
  }
  return { del, add };
}

/** Indices into a DiffLine[] where a hunk header occurs (for prev/next-hunk navigation). */
export function hunkLineIndices(lines: DiffLine[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'hunk') out.push(i);
  }
  return out;
}

/**
 * Character ranges that changed within a del/add line pair, per side, from a
 * word-level diff. Returns null when the pair has little in common (so
 * marking nearly the whole line would only add noise) — the caller then
 * renders the lines without intraline marks, as GitHub does.
 */
export function intralineRanges(oldText: string, newText: string): { del: [number, number][]; add: [number, number][] } | null {
  if (!oldText.trim() || !newText.trim()) return null;
  if (oldText.length > 2000 || newText.length > 2000) return null;
  const { del, add } = wordDiffSegments(oldText, newText);
  const toRanges = (segs: WordSegment[]): { ranges: [number, number][]; changed: number } => {
    const ranges: [number, number][] = [];
    let pos = 0;
    let changed = 0;
    for (const s of segs) {
      const end = pos + s.text.length;
      if (s.changed && s.text.length > 0) {
        const last = ranges[ranges.length - 1];
        if (last && last[1] === pos) last[1] = end; else ranges.push([pos, end]);
        changed += s.text.length;
      }
      pos = end;
    }
    return { ranges, changed };
  };
  const d = toRanges(del);
  const a = toRanges(add);
  const oldLen = oldText.trim().length || 1;
  const newLen = newText.trim().length || 1;
  // Mostly rewritten: skip the marks.
  if (d.changed / oldLen > 0.7 && a.changed / newLen > 0.7) return null;
  return { del: d.ranges, add: a.ranges };
}

/**
 * Wrap character ranges of the *text* of an already highlighted HTML line in
 * `<mark>` spans, splitting text nodes at range boundaries so highlight.js
 * token spans stay intact. Ranges are [start, end) offsets into the plain text.
 */
export function markRanges(html: string, ranges: [number, number][], className = 'diff-mark'): string {
  if (ranges.length === 0) return html;
  return markCache.get(`${className}\n${ranges.join(';')}\n${html}`, () => markRangesUncached(html, ranges, className));
}

function markRangesUncached(html: string, ranges: [number, number][], className: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  let offset = 0;
  for (const node of textNodes) {
    const start = offset;
    const end = offset + node.data.length;
    offset = end;
    // Pieces of this node: alternate unmarked / marked according to ranges.
    const cuts: { from: number; to: number; marked: boolean }[] = [];
    let pos = start;
    for (const [rs, re] of ranges) {
      const a = Math.max(rs, start);
      const b = Math.min(re, end);
      if (b <= a) continue;
      if (a > pos) cuts.push({ from: pos, to: a, marked: false });
      cuts.push({ from: a, to: b, marked: true });
      pos = b;
    }
    if (pos < end) cuts.push({ from: pos, to: end, marked: false });
    if (!cuts.some(c => c.marked)) continue;
    const frag = document.createDocumentFragment();
    for (const c of cuts) {
      const piece = node.data.slice(c.from - start, c.to - start);
      if (c.marked) {
        const m = document.createElement('mark');
        m.className = className;
        m.textContent = piece;
        frag.appendChild(m);
      } else {
        frag.appendChild(document.createTextNode(piece));
      }
    }
    node.parentNode?.replaceChild(frag, node);
  }
  return tpl.innerHTML;
}

/** Small non-cryptographic hash for fingerprinting patch text. */
export function textFingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + text.length;
}
