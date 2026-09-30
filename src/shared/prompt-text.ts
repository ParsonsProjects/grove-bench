/**
 * User messages are stored as sent to the agent: the prompt editor prepends a
 * `<file path="…">…</file>` / `<folder path="…">…</folder>` block for each
 * attached text file and @-reference (see renderer/lib/prompt-file-refs.ts),
 * then a blank line and the typed text. These helpers recover what the user
 * typed and saw.
 */

/** `@` and everything up to whitespace, so names with `+`, `[ ]`, `( )`, `@`
 *  or non-ASCII letters survive (SvelteKit `+page.svelte`, Next.js
 *  `[id].tsx`, `@types/…`, `café.ts`). Paths with spaces aren't supported. */
const AT_REF_RE = /@(\S+)/g;
/** Punctuation that ends a sentence or closes a bracket around a reference. */
const TRAILING_PUNCT_RE = /[.,;:!?'"`)\]}>]+$/;

/** Extract @-references from prompt text. A trailing `/` marks a folder. */
export function extractAtRefs(text: string): string[] {
  const refs: string[] = [];
  let match;
  while ((match = AT_REF_RE.exec(text)) !== null) {
    const ref = match[1].replace(TRAILING_PUNCT_RE, '');
    if (ref) refs.push(ref);
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
const FIRST_CLOSE_BLOCK_RE = /^<(file|folder) path="([^"]*)"(?: length="\d+")?>\n([\s\S]*?)\n<\/\1>\n*/;

/** A leading content block: the file or folder path and what it held. */
export interface SentBlock {
  path: string;
  content: string;
}

/** The leading content block of `text`, and where it ends. */
function leadingBlock(text: string): (SentBlock & { end: number }) | null {
  const open = BLOCK_OPEN_RE.exec(text);
  if (!open) return null;
  if (open[3] !== undefined) {
    const close = `\n</${open[1]}>`;
    const contentEnd = open[0].length + Number(open[3]);
    if (text.startsWith(close, contentEnd)) {
      let end = contentEnd + close.length;
      while (text[end] === '\n') end++;
      return { path: open[2], content: text.slice(open[0].length, contentEnd), end };
    }
  }
  // No length, or it doesn't line up: end at the first closing tag
  const block = FIRST_CLOSE_BLOCK_RE.exec(text);
  return block ? { path: block[2], content: block[3], end: block[0].length } : null;
}

/** Split a sent message into its leading content blocks (in order) and the
 *  typed text after them. */
function splitSentPrompt(sent: string): { blocks: SentBlock[]; typed: string } {
  const blocks: SentBlock[] = [];
  let typed = sent;
  for (let b = leadingBlock(typed); b; b = leadingBlock(typed)) {
    blocks.push({ path: b.path, content: b.content });
    typed = typed.slice(b.end);
  }
  return { blocks, typed };
}

/** Split a sent message into the paths of its leading content blocks (in
 *  order) and the typed text after them. */
export function parseSentPrompt(sent: string): { paths: string[]; typed: string } {
  const { blocks, typed } = splitSentPrompt(sent);
  return { paths: blocks.map((b) => b.path), typed };
}

/** The typed prompt from a sent message, without the content blocks. */
export function stripFileContext(sent: string): string {
  return parseSentPrompt(sent).typed;
}

/**
 * The files attached to a sent message, with their content, and the typed
 * text. Blocks for @-references are left out: the reference stays in the text.
 */
export function attachedFilesFromSent(sent: string): { files: SentBlock[]; typed: string } {
  const { blocks, typed } = splitSentPrompt(sent);
  if (blocks.length === 0) return { files: [], typed };
  // The editor adds one block per @-reference after the attached files. Take
  // them off the end by count, so an attached file with the same name as a
  // reference stays.
  const refs = new Map<string, number>();
  for (const ref of extractAtRefs(typed)) refs.set(ref, (refs.get(ref) ?? 0) + 1);
  let end = blocks.length;
  while (end > 0) {
    const left = refs.get(blocks[end - 1].path) ?? 0;
    if (left === 0) break;
    refs.set(blocks[end - 1].path, left - 1);
    end--;
  }
  return { files: blocks.slice(0, end), typed };
}

/** A typed prompt with its attachment names as a leading "[a.ts, b.png] " label. */
export function withAttachmentLabel(names: string[], typed: string): string {
  return names.length > 0 ? `[${names.join(', ')}] ${typed}` : typed;
}

/**
 * A sent message as one line of text: attached files, then `images`, as a
 * leading "[a.ts, shot.png] " label, @-references left in the text. Images
 * aren't part of the sent text, so they are passed in (from the event).
 */
export function displayTextFromSent(sent: string, images: { name?: string }[] = []): string {
  const { files, typed } = attachedFilesFromSent(sent);
  const imageNames = images.flatMap((img) => (img.name ? [img.name] : []));
  return withAttachmentLabel([...files.map((f) => f.path), ...imageNames], typed);
}
