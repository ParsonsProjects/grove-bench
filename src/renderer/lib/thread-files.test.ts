import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { messageStore } from '../stores/messages.svelte.js';
import {
  attachedTextContent, showInThread, textFileMarkdown, threadFileName, threadFileSize, threadImageSrc,
} from './thread-files.js';
import { buildContentBlock } from '../../shared/prompt-text.js';
import type { ThreadFile } from '../../shared/thread-items.js';

const SID = 's1';

afterEach(() => {
  vi.restoreAllMocks();
  messageStore.destroyAllSessions();
});

describe('threadFileName and threadFileSize', () => {
  it('names each kind of file', () => {
    const files: ThreadFile[] = [
      { kind: 'image', from: 'user', image: { file: 'a.png', name: 'shot.png' }, eventIndex: 0 },
      { kind: 'image', from: 'user', image: { file: 'a.png' }, eventIndex: 0 },
      { kind: 'image', from: 'tool', image: { file: 'b.png' }, toolName: 'mcp__grove-preview__screenshot', eventIndex: 0 },
      { kind: 'image', from: 'tool', image: { file: 'b.png' }, eventIndex: 0 },
      { kind: 'text', name: 'notes.md', size: 5, eventIndex: 0 },
      { kind: 'file', file: { file: 'c.pdf', name: 'spec.pdf', mediaType: 'application/pdf', size: 7 }, eventIndex: 0 },
      { kind: 'made', made: { path: 'out/r.html', kind: 'html', size: 9 }, eventIndex: 0 },
    ];
    expect(files.map(threadFileName)).toEqual([
      'shot.png', 'Image', 'Image from screenshot (grove-preview)', 'Image from a tool', 'notes.md', 'spec.pdf', 'out/r.html',
    ]);
    expect(files.map(threadFileSize)).toEqual([undefined, undefined, undefined, undefined, 5, 7, 9]);
  });
});

describe('threadImageSrc', () => {
  it('loads saved images over grove-attachment, and a made image without a copy from the worktree', () => {
    expect(threadImageSrc(SID, { kind: 'image', from: 'user', image: { file: 'a.png' }, eventIndex: 0 }))
      .toBe(`grove-attachment://image/${SID}/a.png`);
    expect(threadImageSrc(SID, { kind: 'made', made: { path: 'c.png', kind: 'image', size: 1, image: { file: 'd.png' } }, eventIndex: 0 }))
      .toBe(`grove-attachment://image/${SID}/d.png`);
    expect(threadImageSrc(SID, { kind: 'made', made: { path: 'out/c.png', kind: 'image', size: 1 }, eventIndex: 0 }))
      .toBe(`grove-attachment://worktree/${SID}/out%2Fc.png`);
    expect(threadImageSrc(SID, { kind: 'made', made: { path: 'r.pdf', kind: 'pdf', size: 1 }, eventIndex: 0 })).toBeNull();
    expect(threadImageSrc(SID, { kind: 'text', name: 'a.png', size: 1, eventIndex: 0 })).toBeNull();
  });
});

describe('textFileMarkdown', () => {
  it('shows markdown as it reads and fences anything else, past any backticks inside', () => {
    expect(textFileMarkdown('README.md', '# Hi')).toBe('# Hi');
    expect(textFileMarkdown('a.ts', 'const a = 1;')).toBe('```ts\nconst a = 1;\n```');
    expect(textFileMarkdown('notes', 'a ```` b')).toBe('`````\na ```` b\n`````');
  });
});

describe('attachedTextContent', () => {
  it("reads a text file from its message's text", async () => {
    const text = `${buildContentBlock('file', 'a.ts', 'one')}\n${buildContentBlock('file', 'b.ts', 'two')}\n\nLook`;
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [{ type: 'user_message', text }], totalCount: 9, startIndex: 4 } as never);
    expect(await attachedTextContent(SID, 4, 'b.ts')).toBe('two');
    expect(mockGroveBench.getEventHistoryPage).toHaveBeenCalledWith(SID, 1, 5);
  });

  it('gives null when the message is gone or is something else', async () => {
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [], totalCount: 2, startIndex: 2 });
    expect(await attachedTextContent(SID, 4, 'a.ts')).toBeNull();
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [{ type: 'assistant_text', text: 'x', uuid: 'u' }], totalCount: 9, startIndex: 4 } as never);
    expect(await attachedTextContent(SID, 4, 'a.ts')).toBeNull();
  });
});

describe('showInThread', () => {
  it('opens the Thread tab and asks it to jump to the event', () => {
    messageStore.setActiveTab(SID, 'changes');
    showInThread(SID, 12);
    expect(messageStore.getActiveTab(SID)).toBe('activity');
    expect(messageStore.pendingJumpBySession[SID]).toEqual({ eventIndex: 12, uuid: null, bookmarkId: '' });
  });
});
