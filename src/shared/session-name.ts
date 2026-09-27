const MAX_LEN = 40;

/**
 * Openers that carry no meaning in a name. Most prompts start with one, so
 * names cut from the start of the prompt looked alike across conversations
 * ("Can you look at the…"). Longest first so the alternation prefers
 * "take a look at" over "look at".
 */
const FILLER_OPENERS = [
  'hi', 'hey', 'hello', 'claude,',
  'please', 'pls', 'kindly',
  'can you', 'could you', 'would you', 'will you', 'can we', 'could we',
  "i'd like you to", 'i would like you to', 'i want you to', 'i need you to',
  "i'd like to", 'i would like to', 'i want to', 'i need to',
  'help me', "let's", 'lets', 'we need to', 'go ahead and',
  'take a look at', 'have a look at', 'look at', 'look into',
].sort((a, b) => b.length - a.length);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FILLER_RE = new RegExp(
  `^(?:${FILLER_OPENERS.map(escapeRegExp).join('|')})(?=[\\s,!.:;]|$)[\\s,!.:;]*`,
  'i',
);

/** Leading `<file path="…">…</file>` / `<folder …>` blocks that the prompt
 *  editor prepends to the text sent for attachments and @-references. */
const FILE_CONTEXT_RE = /^(?:<(file|folder) path="[^"]*">\n[\s\S]*?\n<\/\1>\n*)+/;

/** The typed prompt from a message as sent to the agent, without the file
 *  content blocks prepended for attachments and @-references. */
export function stripFileContext(message: string): string {
  return message.replace(FILE_CONTEXT_RE, '');
}

/** Strip a message down to its instruction text, or '' when nothing is left. */
function cleanPrompt(text: string): string {
  // Collapse all whitespace (incl. newlines) to single spaces.
  let out = text.replace(/\s+/g, ' ').trim();
  // Drop file context that would otherwise lead (and truncate) the name:
  // - a leading attachment list "[a.ts, b.ts] …" prepended by PromptEditor, and
  // - leading @-mention file refs ("@src/foo.ts …").
  // This keeps the name about the instruction, not the files.
  out = out.replace(/^\[[^\]\n]*\]\s*/, '');
  out = out.replace(/^(?:@\S+\s*)+/, '');
  // Strip code/markdown noise: backticks, then leading heading/quote/list
  // markers, then surrounding quotes.
  return out
    .replace(/`/g, '')
    .replace(/^[#>\-*\s]+/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

/** Drop stacked filler openers ("Hi, can you please look at the…") and a
 *  leading article. Returns '' when the text was nothing but filler. */
function stripFiller(text: string): string {
  let out = text.replace(/’/g, "'");
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(FILLER_RE, '');
  }
  return out.replace(/^(?:the|a|an)\s+/i, '').trim();
}

/** Capitalise a plain lowercase first word ("fix" → "Fix"), leaving
 *  identifiers and paths ("useEffect", "src/foo.ts") as typed. */
function capitalise(text: string): string {
  return /^[a-z]+(?=[\s,;:!?]|$)/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

function truncate(text: string): string {
  if (text.length <= MAX_LEN) return text;
  // Truncate on a word boundary within MAX_LEN, then add an ellipsis.
  const cut = text.slice(0, MAX_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${base}…`;
}

/** Trimmed message text, or null for empty messages and slash commands
 *  (/clear, /compact, …), which make poor names. */
function namingText(message: string): string | null {
  const text = message?.trim();
  return text && !text.startsWith('/') ? text : null;
}

/**
 * Derive a short, human-friendly session name from a user message (heuristic,
 * no LLM). Used when the provider has no title of its own for the
 * conversation. Accepts the displayed or the sent text (file content blocks
 * are skipped). Returns null when the message is empty, a slash command, or
 * has no meaningful text after stripping markdown/code noise.
 */
export function deriveSessionName(firstUserMessage: string): string | null {
  const text = namingText(stripFileContext(firstUserMessage ?? ''));
  if (!text) return null;
  const cleaned = cleanPrompt(text);
  if (!cleaned) return null;
  // A prompt that is only filler ("Can you please") keeps its own words.
  const core = (stripFiller(cleaned) || cleaned).replace(/[.,;:!]+$/, '');
  return truncate(capitalise(core || cleaned));
}

/**
 * The name older builds derived (no filler stripping). Only used to recognise
 * an existing name as auto-generated, so it can be replaced with a better
 * one; a name that doesn't match was typed by the user and is kept.
 */
export function legacySessionName(firstUserMessage: string): string | null {
  const text = namingText(firstUserMessage);
  if (!text) return null;
  const cleaned = cleanPrompt(text);
  return cleaned ? truncate(cleaned) : null;
}
