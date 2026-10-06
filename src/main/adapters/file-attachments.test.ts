import { describe, it, expect } from 'vitest';
import { attachedFilesNote } from './file-attachments.js';
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
