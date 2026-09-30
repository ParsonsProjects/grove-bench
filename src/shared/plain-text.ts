/**
 * Markdown to plain text, for one-line previews (the sidebar's row subtitle,
 * the session finder). Drops the syntax a reader would otherwise see as
 * clutter: heading and list markers, table pipes, emphasis, code ticks and
 * link targets. Line breaks are kept, so callers still collapse whitespace.
 *
 * Deliberately small: underscore emphasis is left alone, because underscores
 * are far more often part of a name (snake_case, __init__.py) than emphasis.
 * Code, inline or fenced, is kept exactly as written.
 */
export function stripMarkdown(text: string): string {
  // Code is set aside first so no rule below can touch it: each span or
  // fenced line becomes a placeholder, restored at the end.
  const code: string[] = [];
  const hold = (s: string) => `${code.push(s) - 1}`;

  let inFence = false;
  const lines = text.split('\n').flatMap((line) => {
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return []; // the fence line itself goes
    }
    return [inFence ? hold(line) : line.replace(/`([^`\n]+)`/g, (_, c: string) => hold(c))];
  });

  return lines.join('\n')
    // Table separator rows: only pipes, colons, dashes and spaces, with at
    // least one pipe (|---|:--:|, |-|-|). Horizontal rules: ---, ***, ___.
    .replace(/^(?=[^\n]*\|)(?=[^\n]*-)[ \t|:-]+$/gm, '')
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    // Line prefixes: headings, blockquotes, list and task markers.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    // Table rows (lines fenced by pipes): cells joined with a dot. Pipes
    // anywhere else (a shell pipeline, `a || b`) are left alone.
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells: string) => cells.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))
    // Images and links keep their text; bare autolinks keep the address.
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    // Emphasis must open on a letter, digit or code and sit at word edges,
    // so globs (src/**/*.ts, *.ts|*.js) and maths (2 * 3 * 4) are left alone.
    .replace(/(?<![\w*/])\*\*(?=[\p{L}\p{N}])([^\n]+?)(?<=[^\s*/])\*\*(?![\w*/])/gu, '$1')
    .replace(/~~(?=\S)([^\n]+?)(?<=\S)~~/g, '$1')
    .replace(/(?<![\w*/])\*(?=[\p{L}\p{N}])([^*\n]+?)(?<=[^\s*/])\*(?![\w*/])/gu, '$1')
    .replace(/(\d+)/g, (_, i: string) => code[Number(i)]);
}

/** Text as one line: whitespace runs become single spaces, and anything past
 *  `maxLen` is cut with an ellipsis. */
export function oneLine(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

/** How much of a message a snippet looks at. The preview shows far less, and
 *  a cap keeps stripping fast on any input (a huge paste, a long log). */
const SNIPPET_SCAN = 2000;

/** A message as a one-line plain-text preview. Empty when the message is only
 *  markdown syntax, so callers can fall back to another message. */
export function plainSnippet(text: string, maxLen: number): string {
  return oneLine(stripMarkdown(text.length > SNIPPET_SCAN ? text.slice(0, SNIPPET_SCAN) : text), maxLen);
}
