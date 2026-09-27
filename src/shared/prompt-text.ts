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

/** One leading content block; the path is captured, the content skipped. */
const BLOCK_RE = /^<(file|folder) path="([^"]*)">\n[\s\S]*?\n<\/\1>\n*/;

/** Split a sent message into the paths of its leading content blocks (in
 *  order) and the typed text after them. */
export function parseSentPrompt(sent: string): { paths: string[]; typed: string } {
  const paths: string[] = [];
  let typed = sent;
  for (let m = BLOCK_RE.exec(typed); m; m = BLOCK_RE.exec(typed)) {
    paths.push(m[2]);
    typed = typed.slice(m[0].length);
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
