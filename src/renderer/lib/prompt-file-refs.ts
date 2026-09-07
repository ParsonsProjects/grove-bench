/**
 * @-file inclusion for the prompt editor.
 *
 * When the user references files with `@path/to/file` (or `@dir/` for a
 * folder), the referenced content is read from the session worktree and
 * prepended to the outgoing message as `<file path="...">` / `<folder
 * path="...">` tags, so the LLM receives the actual content — the visible
 * chat message keeps only the original text.
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
 * Read each @-reference and wrap it in a `<file>`/`<folder>` tag. Unreadable
 * refs (typos, or false positives like the domain of an e-mail address) still
 * produce a tag with a "(could not read)" body so the model knows the
 * reference could not be resolved.
 */
export async function buildRefTags(
  refs: string[],
  readFile: (path: string) => Promise<string>,
): Promise<string[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const tag = ref.endsWith('/') ? 'folder' : 'file';
      try {
        const content = await readFile(ref);
        return `<${tag} path="${ref}">\n${content}\n</${tag}>`;
      } catch {
        return `<${tag} path="${ref}">\n(could not read)\n</${tag}>`;
      }
    }),
  );
}

/**
 * Assemble the message actually sent to the LLM: content tags (dropped
 * attachments first, then @-references) followed by the user's text.
 */
export function buildOutgoingMessage(tags: string[], text: string): string {
  return tags.length > 0 ? tags.join('\n') + '\n\n' + text : text;
}
