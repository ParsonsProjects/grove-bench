import hljs from './hljs.js';
import DOMPurify from 'dompurify';
import { diffWordsWithSpace } from 'diff';
import type { DiffLine } from './diff-types.js';

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
  const key = `${lang}\n${text}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = DOMPurify.sanitize(hljs.highlight(text, { language: lang }).value);
  } catch {
    html = escapeHtml(text);
  }
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) highlightCache.clear();
  highlightCache.set(key, html);
  return html;
}

/** DiffView calls highlightLine for every line on every re-render of the
 *  diff, and each call builds a DOMPurify document. Lines are unchanged
 *  across re-renders (and repeat across files), so memoize by (lang, text). */
const HIGHLIGHT_CACHE_MAX = 5000;
const highlightCache = new Map<string, string>();

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
