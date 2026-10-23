/**
 * Turn terminal output into prompt context.
 *
 * The user picks either a selection in the terminal or, with nothing
 * selected, the tail of the scrollback. The text is fenced so the agent
 * sees it as output rather than instructions.
 */

/** The parts of xterm's IBuffer / IBufferLine this needs (kept minimal for tests). */
export interface BufferLineLike {
  translateToString(trimRight?: boolean): string;
}
export interface BufferLike {
  readonly length: number;
  getLine(y: number): BufferLineLike | undefined;
}

export const DEFAULT_TAIL_LINES = 200;
export const DEFAULT_MAX_CHARS = 20_000;

/** Last `maxLines` non-empty-tail lines of the buffer, oldest first. */
export function collectTailLines(buffer: BufferLike, maxLines = DEFAULT_TAIL_LINES): string[] {
  const lines: string[] = [];
  for (let y = buffer.length - 1; y >= 0 && lines.length < maxLines; y--) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    // Skip the blank rows below the prompt; keep blanks once real text starts
    if (lines.length === 0 && text.trim() === '') continue;
    lines.push(text);
  }
  return lines.reverse();
}

export interface FormatOptions {
  /** True when the text is a user selection rather than the buffer tail. */
  selected: boolean;
  maxChars?: number;
}

/** Trim to the last `maxChars` characters at a line boundary. */
export function truncateHead(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  let cut = text.slice(text.length - maxChars);
  const nl = cut.indexOf('\n');
  if (nl >= 0 && nl < cut.length - 1) cut = cut.slice(nl + 1);
  return { text: cut, truncated: true };
}

/** Fenced block ready to insert into the prompt. Empty input yields ''. */
export function formatTerminalContext(raw: string, opts: FormatOptions): string {
  const cleaned = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!cleaned.trim()) return '';
  const { text, truncated } = truncateHead(cleaned, opts.maxChars ?? DEFAULT_MAX_CHARS);
  const lineCount = text.split('\n').length;
  const what = opts.selected ? 'Terminal selection' : `Terminal output (last ${lineCount} line${lineCount === 1 ? '' : 's'})`;
  const note = truncated ? ', earlier output truncated' : '';
  // Use a fence longer than any run of backticks in the text so it can't close early.
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${what}${note}:\n${fence}text\n${text}\n${fence}`;
}
