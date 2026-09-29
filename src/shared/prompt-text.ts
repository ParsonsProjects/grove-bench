/**
 * User messages are stored as sent to the agent: the prompt editor prepends a
 * `<file path="…">…</file>` / `<folder path="…">…</folder>` block for each
 * attached text file and @-reference (see renderer/lib/prompt-file-refs.ts),
 * then a blank line and the typed text. These helpers recover what the user
 * typed and saw.
 */

const AT_REF_RE = /@([\w.\/\-]+)/g;

/** Extract @-references from prompt text. A trailing `/` marks a folder. */
export function extractAtRefs(text: string): string[] {
  const refs: string[] = [];
  let match;
  while ((match = AT_REF_RE.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * Wrap file or folder content in the block the agent receives. `length` lets
 * parseSentPrompt skip exactly the content, which may itself contain a
 * `</file>` line (an XML file, or this very module).
 */
export function buildContentBlock(tag: 'file' | 'folder', path: string, content: string): string {
  return `<${tag} path="${path}" length="${content.length}">\n${content}\n</${tag}>`;
}

/** A leading block's opening tag. `length` is absent in messages sent before
 *  it was added. */
const BLOCK_OPEN_RE = /^<(file|folder) path="([^"]*)"(?: length="(\d+)")?>\n/;
/** Fallback for blocks without a usable `length`: ends at the first closing tag. */
const FIRST_CLOSE_BLOCK_RE = /^<(file|folder) path="([^"]*)"(?: length="\d+")?>\n[\s\S]*?\n<\/\1>\n*/;

/** The length of the leading content block of `text`, and its path. */
function leadingBlock(text: string): { path: string; end: number } | null {
  const open = BLOCK_OPEN_RE.exec(text);
  if (!open) return null;
  if (open[3] !== undefined) {
    const close = `\n</${open[1]}>`;
    const contentEnd = open[0].length + Number(open[3]);
    if (text.startsWith(close, contentEnd)) {
      let end = contentEnd + close.length;
      while (text[end] === '\n') end++;
      return { path: open[2], end };
    }
  }
  // No length, or it doesn't line up: end at the first closing tag
  const block = FIRST_CLOSE_BLOCK_RE.exec(text);
  return block ? { path: block[2], end: block[0].length } : null;
}

/** Split a sent message into the paths of its leading content blocks (in
 *  order) and the typed text after them. */
export function parseSentPrompt(sent: string): { paths: string[]; typed: string } {
  const paths: string[] = [];
  let typed = sent;
  for (let b = leadingBlock(typed); b; b = leadingBlock(typed)) {
    paths.push(b.path);
    typed = typed.slice(b.end);
  }
  return { paths, typed };
}

/** The typed prompt from a sent message, without the content blocks. */
export function stripFileContext(sent: string): string {
  return parseSentPrompt(sent).typed;
}

/**
 * A sent message as the chat showed it when it was sent: attached files as a
 * leading "[a.ts, b.ts] " label, @-references left in the text. Image
 * attachments aren't part of the sent text, so they can't be listed.
 */
export function displayTextFromSent(sent: string): string {
  const { paths, typed } = parseSentPrompt(sent);
  if (paths.length === 0) return typed;
  const refs = new Set(extractAtRefs(typed));
  const attached = paths.filter((p) => !refs.has(p));
  return attached.length > 0 ? `[${attached.join(', ')}] ${typed}` : typed;
}
