import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

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

  it('shows an image sent without text', () => {
    const { container } = render(UserPromptBlock, { sessionId: SID, text: '', images: [{ name: 'shot.png', dataUrl: DATA_URL }] });
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeInTheDocument();
    expect(container.querySelector('.markdown-content')).toBeNull();
  });
});
