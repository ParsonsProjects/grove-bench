import { describe, it, expect } from 'vitest';
import type { AgentEvent, StoredFile } from '../../shared/types.js';
import { AUDIO_INLINE_MAX_BYTES, attachedFilesNote, audioSentInline, inlineAudioType } from './file-attachments.js';
import type { MessageFile } from './types.js';

function file(over: Partial<MessageFile> = {}): MessageFile {
  return { name: 'spec.pdf', mediaType: 'application/pdf', data: '', path: 'C:\\att\\abc.pdf', size: 10, ...over };
}

describe('attachedFilesNote', () => {
  it('lists each file with its name, type, size and absolute path', () => {
    const note = attachedFilesNote([
      file({ name: 'budget.xlsx', mediaType: 'application/vnd.ms-excel', size: 1234, path: 'C:\\att\\1.xlsx' }),
      file({ name: 'notes', mediaType: '', size: 5, path: 'C:\\att\\2' }),
    ]);
    expect(note).toBe([
      '<attached_files>',
      'The user attached these files to their message. They are saved outside the project: open them by the absolute path given, an exception to the relative path rule.',
      '<file name="budget.xlsx" type="application/vnd.ms-excel" size="1234" path="C:\\att\\1.xlsx" />',
      '<file name="notes" size="5" path="C:\\att\\2" />',
      '</attached_files>',
    ].join('\n'));
  });

  it('escapes names that would break the attribute', () => {
    expect(attachedFilesNote([file({ name: 'a "b" <c> & d.pdf' })])).toContain('name="a &quot;b&quot; &lt;c> &amp; d.pdf"');
  });
});

describe('inlineAudioType', () => {
  it('maps the listed types and their browser aliases to the type sent', () => {
    expect(inlineAudioType({ mediaType: 'audio/mpeg', size: 10 })).toBe('audio/mpeg');
    expect(inlineAudioType({ mediaType: 'audio/x-wav', size: 10 })).toBe('audio/wav');
    expect(inlineAudioType({ mediaType: 'audio/mp4', size: 10 })).toBe('audio/m4a');
  });

  it('is null for other types, Object.prototype names and clips over the cap', () => {
    expect(inlineAudioType({ mediaType: 'audio/x-ms-wma', size: 10 })).toBeNull();
    expect(inlineAudioType({ mediaType: 'constructor', size: 10 })).toBeNull();
    expect(inlineAudioType({ mediaType: 'audio/mpeg', size: AUDIO_INLINE_MAX_BYTES + 1 })).toBeNull();
  });
});

describe('audioSentInline', () => {
  const clip = (size: number, mediaType = 'audio/mpeg'): StoredFile => ({ file: 'f', name: 'a', mediaType, size });
  const sent = (...files: StoredFile[]): AgentEvent => ({ type: 'user_message', text: 'x', files });

  it('adds up the clips that could have gone inline', () => {
    expect(audioSentInline([sent(clip(100), clip(50, 'application/pdf')), sent(clip(AUDIO_INLINE_MAX_BYTES + 1)), sent(clip(20))])).toBe(120);
  });

  it('counts only since the last switch of agent or new conversation', () => {
    const switched: AgentEvent = { type: 'agent_changed', from: 'a', to: 'b', fromName: 'A', toName: 'B', transcript: false };
    const fresh: AgentEvent = { type: 'status', message: 'new', newConversation: true };
    expect(audioSentInline([sent(clip(100)), switched, sent(clip(7))])).toBe(7);
    expect(audioSentInline([sent(clip(100)), fresh, sent(clip(5)), sent(clip(5))])).toBe(10);
  });
});
