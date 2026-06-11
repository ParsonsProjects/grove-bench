import hljs from 'highlight.js';
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
  try {
    return DOMPurify.sanitize(hljs.highlight(text, { language: lang }).value);
  } catch {
    return escapeHtml(text);
  }
}

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
