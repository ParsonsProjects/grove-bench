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
import type { AgentEvent } from '../../shared/types.js';
import type { MessageFile } from './types.js';

/** Audio goes inline only up to this size... */
export const AUDIO_INLINE_MAX_BYTES = 5 * 1024 * 1024;
/** ...and only until this much is inline in the agent's conversation, since
 *  it stays in the agent's history. Gemini caps a request with inline data
 *  at 20 MB. Inline images aren't counted. */
export const AUDIO_INLINE_BUDGET_BYTES = 10 * 1024 * 1024;

/** The audio types that go inline, by the type the browser reports, mapped
 *  to the type sent: Gemini's documented ones, with the aliases browsers
 *  use. Anything else goes by path. */
const INLINE_AUDIO_TYPES: Readonly<Record<string, string>> = {
  'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav',
  'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mp3',
  'audio/aiff': 'audio/aiff', 'audio/x-aiff': 'audio/aiff',
  'audio/aac': 'audio/aac',
  'audio/ogg': 'audio/ogg',
  'audio/flac': 'audio/flac', 'audio/x-flac': 'audio/flac',
  'audio/m4a': 'audio/m4a', 'audio/x-m4a': 'audio/m4a', 'audio/mp4': 'audio/m4a',
  'audio/opus': 'audio/opus',
  'audio/webm': 'audio/webm',
};

/** The type to send a clip inline as, or null when it goes by path: not a
 *  listed type, or over the size cap. */
export function inlineAudioType(file: Pick<MessageFile, 'mediaType' | 'size'>): string | null {
  if (file.size > AUDIO_INLINE_MAX_BYTES || !Object.hasOwn(INLINE_AUDIO_TYPES, file.mediaType)) return null;
  return INLINE_AUDIO_TYPES[file.mediaType];
}

/**
 * Bytes of audio that may be inline in the agent's current conversation:
 * clips of a type and size that go inline, sent since the last switch of
 * agent or new conversation. Read from the thread's own history, so it holds
 * across restarts, and counted whether or not the agent took them, so it
 * errs high.
 */
export function audioSentInline(events: readonly AgentEvent[]): number {
  const start = Math.max(
    events.findLastIndex((e) => e.type === 'agent_changed'),
    events.findLastIndex((e) => e.type === 'status' && e.newConversation === true),
  );
  let bytes = 0;
  for (let i = start + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'user_message') continue;
    for (const f of e.files ?? []) if (inlineAudioType(f)) bytes += f.size;
  }
  return bytes;
}

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
