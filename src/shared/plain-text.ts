/**
 * Markdown to plain text, for one-line previews (the sidebar's row subtitle,
 * the session finder). Drops the syntax a reader would otherwise see as
 * clutter: heading and list markers, table pipes, emphasis, code ticks and
 * link targets. Line breaks are kept, so callers still collapse whitespace.
 *
 * Deliberately small: underscore emphasis is left alone, because underscores
 * are far more often part of a name (snake_case, __init__.py) than emphasis.
 */
export function stripMarkdown(text: string): string {
  return text
    // Code fence lines (```ts, ~~~); the code inside stays.
    .replace(/^[ \t]*(```|~~~).*$/gm, '')
    // Table separator rows (|---|:--:|) and horizontal rules (---, ***, ___).
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    // Line prefixes: headings, blockquotes, list and task markers.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    // Table rows (lines fenced by pipes): cells joined with a dot. Pipes
    // anywhere else (a shell pipeline, `a || b`) are left alone.
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells: string) => cells.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))
    // Images and links keep their text; bare autolinks keep the address.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    // Inline emphasis and code.
    // The stars must sit at word edges, so globs (src/**/*.ts) and maths
    // (2 * 3 * 4) are left alone.
    .replace(/(?<![\w*/])\*\*(?=[^\s*/])(.+?)(?<=[^\s*/])\*\*(?![\w*/])/g, '$1')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/(?<![\w*/])\*(?=[^\s*/])([^*\n]+?)(?<=[^\s*/])\*(?![\w*/])/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}
