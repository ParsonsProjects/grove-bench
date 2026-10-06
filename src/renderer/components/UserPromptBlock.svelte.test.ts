import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import UserPromptBlock from './UserPromptBlock.svelte';

const SID = 's1';
const DATA_URL = 'data:image/png;base64,iVBOR';

afterEach(() => {
  cleanup();
});

describe('UserPromptBlock attachments', () => {
  it('shows attached files as chips that open and close their content', async () => {
    render(UserPromptBlock, {
      sessionId: SID,
      text: 'fix it',
      files: [{ path: 'notes.md', content: 'the notes' }],
    });

    const chip = screen.getByRole('button', { name: 'notes.md' });
    expect(screen.queryByText('the notes')).toBeNull();
    await fireEvent.click(chip);
    expect(screen.getByText('the notes')).toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.click(chip);
    expect(screen.queryByText('the notes')).toBeNull();
  });

  it('shows a just-sent image and enlarges it on click', async () => {
    render(UserPromptBlock, { sessionId: SID, text: 'what is this?', images: [{ name: 'shot.png', dataUrl: DATA_URL }] });

    expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute('src', DATA_URL);
    await fireEvent.click(screen.getByRole('button', { name: 'View shot.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('img')).toHaveAttribute('src', DATA_URL);
  });

  it('loads a saved image from the conversation, lazily', () => {
    const file = `${'a'.repeat(32)}.png`;
    render(UserPromptBlock, { sessionId: SID, text: 'look', images: [{ file, name: 'shot.png' }] });

    const img = screen.getByRole('img', { name: 'shot.png' });
    expect(img).toHaveAttribute('src', `grove-attachment://image/${SID}/${file}`);
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('says so when a saved image is gone', async () => {
    render(UserPromptBlock, { sessionId: SID, text: 'look', images: [{ file: `${'b'.repeat(32)}.png`, name: 'shot.png' }] });
    await fireEvent.error(screen.getByRole('img', { name: 'shot.png' }));
    expect(screen.getByText('Image not available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View shot.png' })).toBeNull();
  });

  it('shows other attached files as chips that open the saved copy', async () => {
    const file = `${'c'.repeat(32)}.pdf`;
    render(UserPromptBlock, {
      sessionId: SID, text: 'summarise', attachments: [{ file, name: 'spec.pdf', mediaType: 'application/pdf', size: 2048 }],
    });

    const chip = screen.getByRole('button', { name: 'spec.pdf' });
    expect(chip).toHaveAttribute('title', 'spec.pdf (2 KB)');
    await fireEvent.click(chip);
    expect(mockGroveBench.openAttachedFile).toHaveBeenCalledWith(SID, file);
  });

  it('turns a chip off when its file is gone', async () => {
    vi.mocked(mockGroveBench.openAttachedFile).mockResolvedValueOnce(false);
    render(UserPromptBlock, {
      sessionId: SID, text: 'look', attachments: [{ file: `${'d'.repeat(32)}.zip`, name: 'logs.zip', mediaType: 'application/zip', size: 10 }],
    });

    const chip = screen.getByRole('button', { name: 'logs.zip' });
    await fireEvent.click(chip);
    await waitFor(() => expect(chip).toBeDisabled());
    expect(chip).toHaveAttribute('title', 'logs.zip is no longer available');
  });

  it('shows a file main has not saved yet without a way to open it', () => {
    render(UserPromptBlock, { sessionId: SID, text: 'look', attachments: [{ name: 'memo.mp3', mediaType: 'audio/mpeg', size: 10 }] });
    expect(screen.getByRole('button', { name: 'memo.mp3' })).toBeDisabled();
  });

  it('shows an image sent without text', () => {
    const { container } = render(UserPromptBlock, { sessionId: SID, text: '', images: [{ name: 'shot.png', dataUrl: DATA_URL }] });
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeInTheDocument();
    expect(container.querySelector('.markdown-content')).toBeNull();
  });
});
