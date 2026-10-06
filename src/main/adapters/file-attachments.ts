/**
 * How adapters pass on the files attached to a message that go neither as
 * text nor as an image (MessageFile). The session manager saves each one to
 * the conversation's attachments folder first, and the agent gets its path.
 * Only audio goes inline, to agents that take it, within the limits below.
 *
 * PDFs go by path too. Anything inline stays in the agent's history and is
 * sent again with every request, and the API's size and page limits count
 * the whole request, so a few inline PDFs could break every later turn.
 * By path, the agent reads the pages it needs with its own tools.
 */
import type { MessageFile } from './types.js';

/** Audio goes inline only up to this size... */
export const AUDIO_INLINE_MAX_BYTES = 5 * 1024 * 1024;
/** ...and only until this much has gone inline to one agent process, since
 *  it stays in the agent's history. Gemini caps a request with inline data at
 *  20 MB. Best effort: a resumed session's earlier clips aren't counted. */
export const AUDIO_INLINE_BUDGET_BYTES = 10 * 1024 * 1024;

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Text that tells the agent where the files it gets by path are. Grove's
 * system prompt asks for relative paths, so it says these are the exception.
 */
export function attachedFilesNote(files: Pick<MessageFile, 'name' | 'mediaType' | 'size' | 'path'>[]): string {
  return [
    '<attached_files>',
    'The user attached these files to their message. They are saved outside the project: open them by the absolute path given, an exception to the relative path rule.',
    ...files.map((f) => `<file name="${attr(f.name)}"${f.mediaType ? ` type="${attr(f.mediaType)}"` : ''} size="${f.size}" path="${attr(f.path)}" />`),
    '</attached_files>',
  ].join('\n');
}
