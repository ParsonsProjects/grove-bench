/**
 * A text file from the worktree as numbered lines, for the Focus panel's
 * code view (a link to `src/app.ts:42` opens it at that line). The file is
 * coloured in one pass, as a code block in a reply is, then cut into lines,
 * so a comment or string that runs over several lines keeps its colour.
 */
import DOMPurify from 'dompurify';
import hljs from './hljs.js';
import { languageForPath } from './diff-highlight.js';
import type { LineRange } from './worktree-files.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlighted HTML cut at each newline. A span still open at the end of a
 *  line is closed there and opened again on the next, so every line is
 *  whole HTML. highlight.js writes nothing but spans and escaped text. */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else if (part.startsWith('<span')) {
      open.push(part);
      line += part;
    } else if (part === '</span>') {
      open.pop();
      line += part;
    } else {
      line += part;
    }
  }
  lines.push(line + '</span>'.repeat(open.length));
  return lines;
}

/** Each line of `text` as safe HTML, coloured for `filePath`'s language when
 *  highlight.js knows it. A final newline ends the last line rather than
 *  starting another, as git counts them. */
export function codeFileLines(text: string, filePath: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lang = languageForPath(filePath);
  let lines: string[] | null = null;
  if (lang) {
    try {
      // Sanitized whole, then cut: cutting only copies tags already in it.
      lines = splitHighlightedLines(DOMPurify.sanitize(hljs.highlight(normalized, { language: lang }).value));
    } catch { /* plain, below */ }
  }
  lines ??= normalized.split('\n').map(escapeHtml);
  if (normalized.endsWith('\n')) lines.pop();
  return lines;
}

/** The code view's HTML: a row per line, numbered in `data-line` (drawn by
 *  CSS, so a copy leaves the numbers out), with the lines a link named
 *  marked `target`. One string, not a component per line: a file can have
 *  thousands. */
export function codeFileHtml(text: string, filePath: string, target: LineRange | null): { html: string; lineCount: number } {
  const lines = codeFileLines(text, filePath);
  const html = lines
    .map((line, i) => {
      const n = i + 1;
      const cls = target && n >= target.start && n <= target.end ? 'code-line target' : 'code-line';
      return `<div class="${cls}" data-line="${n}">${line}</div>`;
    })
    .join('');
  return { html, lineCount: lines.length };
}
