import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/svelte';
import GitIdentityNotice from './GitIdentityNotice.svelte';

afterEach(() => {
  cleanup();
});

describe('GitIdentityNotice', () => {
  it('explains the problem and shows both commands', () => {
    render(GitIdentityNotice);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent("Git doesn't have your name and email");
    expect(note).toHaveTextContent('git config --global user.name "Your Name"');
    expect(note).toHaveTextContent('git config --global user.email "you@example.com"');
  });

  it('copies each command on its own', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(GitIdentityNotice);

    const [nameCopy, emailCopy] = within(screen.getByRole('note')).getAllByRole('button', { name: 'Copy' });
    await fireEvent.click(nameCopy);
    await fireEvent.click(emailCopy);

    expect(writeText.mock.calls).toEqual([
      ['git config --global user.name "Your Name"'],
      ['git config --global user.email "you@example.com"'],
    ]);
  });
});
