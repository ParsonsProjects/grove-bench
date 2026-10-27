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

/** The list, as the activity popup shows it. */
function openPopover(props: { onclose?: () => void; onimage?: (image: { src: string; label: string }) => void } = {}) {
  const { container } = render(StatusBarFiles, { sessionId: SID, files: FILES, onimage: () => {}, ...props });
  return container;
}

describe('StatusBarFiles', () => {
  it('groups the files: yours, the agent\'s, then from tools', async () => {
    const popover = openPopover();
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
    const popover = openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open spec\.pdf/));
    expect(mockGroveBench.openAttachedFile).toHaveBeenCalledWith(SID, 'c.pdf');
    await fireEvent.click(within(popover).getByTitle(/^Open out\/report\.pdf/));
    expect(mockGroveBench.openWorktreeFile).toHaveBeenCalledWith(SID, 'out/report.pdf');
  });

  it('marks a file that is gone', async () => {
    mockGroveBench.openAttachedFile.mockResolvedValueOnce(false);
    const popover = openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open spec\.pdf/));
    await waitFor(() => expect(within(popover).getByTitle('spec.pdf is no longer available')).toBeDisabled());
  });

  it('hands an image to be shown full size, and closes', async () => {
    const onimage = vi.fn();
    const onclose = vi.fn();
    const popover = openPopover({ onimage, onclose });
    await fireEvent.click(within(popover).getByTitle(/^Open mock\.png/));
    expect(onimage).toHaveBeenCalledWith({ src: `grove-attachment://image/${SID}/a.png`, label: 'mock.png' });
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('opens an attached text file in the Focus panel as numbered lines', async () => {
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [{ type: 'user_message', text: `${buildContentBlock('file', 'notes.ts', 'x()')}\n\nLook` }],
      totalCount: 10,
      startIndex: 2,
    } as never);
    const popover = openPopover();
    await fireEvent.click(within(popover).getByTitle(/^Open notes\.ts/));
    await waitFor(() => expect(markdownPreviewStore.open).toBe(true));
    expect(markdownPreviewStore).toMatchObject({ title: 'notes.ts', content: 'x()', code: { path: 'notes.ts', lines: null } });
  });

  it('opens an attached Markdown file as it reads', async () => {
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [{ type: 'user_message', text: `${buildContentBlock('file', 'plan.md', '# Plan')}\n\nLook` }],
      totalCount: 10,
      startIndex: 2,
    } as never);
    render(StatusBarFiles, { sessionId: SID, files: [{ kind: 'text', name: 'plan.md', size: 6, eventIndex: 2 }], onimage: () => {} });
    await fireEvent.click(screen.getByTitle(/^Open plan\.md/));
    await waitFor(() => expect(markdownPreviewStore.open).toBe(true));
    expect(markdownPreviewStore).toMatchObject({ title: 'plan.md', content: '# Plan', code: null });
  });

  it('shows the message a file came with, and closes', async () => {
    const onclose = vi.fn();
    const popover = openPopover({ onclose });
    await fireEvent.click(within(popover).getByRole('button', { name: 'Show out/report.pdf in the thread' }));
    expect(onclose).toHaveBeenCalledOnce();
    expect(messageStore.getActiveTab(SID)).toBe('activity');
    expect(messageStore.pendingJumpBySession[SID]).toEqual({ eventIndex: 9, uuid: null, bookmarkId: '' });
  });
});
