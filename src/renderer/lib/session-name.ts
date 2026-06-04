const MAX_LEN = 40;

/**
 * Derive a short, human-friendly session name from a user message (heuristic,
 * no LLM). Returns null when the message is empty, a slash command, or has no
 * meaningful text after stripping markdown/code noise.
 */
export function deriveSessionName(firstUserMessage: string): string | null {
  if (!firstUserMessage) return null;
  let text = firstUserMessage.trim();
  // Slash commands (/clear, /compact, …) make poor names.
  if (!text || text.startsWith('/')) return null;

  // Collapse all whitespace (incl. newlines) to single spaces.
  text = text.replace(/\s+/g, ' ').trim();
  // Drop file context that would otherwise lead (and truncate) the name:
  // - a leading attachment list "[a.ts, b.ts] …" prepended by PromptEditor, and
  // - leading @-mention file refs ("@src/foo.ts …").
  // This keeps the name about the instruction, not the files.
  text = text.replace(/^\[[^\]\n]*\]\s*/, '');
  text = text.replace(/^(?:@\S+\s*)+/, '');
  // Strip code/markdown noise: backticks, then leading heading/quote/list
  // markers, then surrounding quotes.
  text = text
    .replace(/`/g, '')
    .replace(/^[#>\-*\s]+/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!text) return null;

  if (text.length <= MAX_LEN) return text;

  // Truncate on a word boundary within MAX_LEN, then add an ellipsis.
  const cut = text.slice(0, MAX_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${base}…`;
}
