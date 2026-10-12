import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { messageStore } from '../stores/messages.svelte.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { buildContentBlock } from '../../shared/prompt-text.js';

import StatusBarFiles from './StatusBarFiles.svelte';
import type { ThreadFile } from '../../shared/thread-items.js';

const SID = 's1';
const FILES: ThreadFile[] = [
  { kind: 'made', made: { path: 'out/report.pdf', kind: 'pdf', size: 2048 }, eventIndex: 9 },
  { kind: 'image', from: 'tool', image: { file: 'b.png' }, toolName: 'Screenshot', eventIndex: 8 },
  { kind: 'file', file: { file: 'c.pdf', name: 'spec.pdf', mediaType: 'application/pdf', size: 10 }, eventIndex: 5 },
  { kind: 'image', from: 'user', image: { file: 'a.png', name: 'mock.png' }, eventIndex: 2 },
  { kind: 'text', name: 'notes.ts', size: 3, eventIndex: 2 },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  messageStore.destroyAllSessions();
  markdownPreviewStore.close();
});

async function openPopover() {
  render(StatusBarFiles, { sessionId: SID, files: FILES });
  await fireEvent.click(screen.getByRole('button', { name: /Files 5/ }));
  return screen.getByRole('dialog', { name: 'Files' });
}

describe('StatusBarFiles', () => {
  it('shows nothing until the thread has a file', () => {
    render(StatusBarFiles, { sessionId: SID, files: [] });
    expect(screen.queryByRole('button', { name: /Files/ })).toBeNull();
  });

  it('groups the files: yours, the agent\'s, then from tools', async () => {
    const popover = await openPopover();
    const sections = within(popover).getAllByRole('list').map((list) => list.closest('section')!);
    expect(sections.map((s) => within(s).getAllByRole('listitem').map((li) => li.querySelector('.font-mono')?.textContent))).toEqual([
      ['spec.pdf', 'mock.png', 'notes.ts'],
      ['out/report.pdf'],
      ['Image from Screenshot'],
    ]);
    expect(within(sections[0]).getByText('You attached')).toBeInTheDocument();
    expect(within(sections[1]).getByText('Made by the agent')).toBeInTheDocument();
    expect(within(sections[2]).getByText('From tools')).toBeInTheDocument();
    expect(within(sections[1]).getByText('2 KB')).toBeInTheDocument();
  });

  it('opens an attached file and a made one as their chips do', async () => {
    const popover = await openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open spec\.pdf/));
    expect(mockGroveBench.openAttachedFile).toHaveBeenCalledWith(SID, 'c.pdf');
    await fireEvent.click(within(popover).getByTitle(/^Open out\/report\.pdf/));
    expect(mockGroveBench.openWorktreeFile).toHaveBeenCalledWith(SID, 'out/report.pdf');
  });

  it('marks a file that is gone', async () => {
    mockGroveBench.openAttachedFile.mockResolvedValueOnce(false);
    const popover = await openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open spec\.pdf/));
    await waitFor(() => expect(within(popover).getByTitle('spec.pdf is no longer available')).toBeDisabled());
  });

  it('shows an image full size', async () => {
    const popover = await openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open mock\.png/));
    const dialog = await screen.findByRole('dialog', { name: 'mock.png' });
    expect(within(dialog).getByRole('img', { name: 'mock.png' })).toHaveAttribute('src', `grove-attachment://image/${SID}/a.png`);
  });

  it('opens an attached text file in the Focus panel', async () => {
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [{ type: 'user_message', text: `${buildContentBlock('file', 'notes.ts', 'x()')}\n\nLook` }],
      totalCount: 10,
      startIndex: 2,
    } as never);
    const popover = await openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open notes\.ts/));
    await waitFor(() => expect(markdownPreviewStore.open).toBe(true));
    expect(markdownPreviewStore.title).toBe('notes.ts');
    expect(markdownPreviewStore.content).toBe('```ts\nx()\n```');
  });

  it('shows the message a file came with', async () => {
    const popover = await openPopover();
    await fireEvent.click(within(popover).getByRole('button', { name: 'Show out/report.pdf in the thread' }));
    expect(messageStore.getActiveTab(SID)).toBe('activity');
    expect(messageStore.pendingJumpBySession[SID]).toEqual({ eventIndex: 9, uuid: null, bookmarkId: '' });
  });
});
