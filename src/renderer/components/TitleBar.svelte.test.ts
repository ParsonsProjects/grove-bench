import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import TitleBar from './TitleBar.svelte';
import FirstSteps from './FirstSteps.svelte';
import { helpStore } from '../stores/help.svelte.js';
import { store } from '../stores/sessions.svelte.js';

afterEach(() => {
  cleanup();
  helpStore.close();
  store.repos = [];
});

describe('Help', () => {
  it('opens with F1 from anywhere', async () => {
    render(TitleBar);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'F1' });
    expect(helpStore.open).toBe(true);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('ignores F1 with a modifier', async () => {
    render(TitleBar);
    await fireEvent.keyDown(window, { key: 'F1', ctrlKey: true });
    expect(helpStore.open).toBe(false);
  });

  it('opens from the ? button, which names its shortcut', async () => {
    render(TitleBar);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toHaveAttribute('title', 'Help (F1)');
    await fireEvent.click(button);
    expect(helpStore.open).toBe(true);
  });

  it('opens at Getting Started from the first steps', async () => {
    store.repos = [];
    render(FirstSteps);
    await fireEvent.click(screen.getByRole('button', { name: 'New here? Read Getting Started (F1)' }));
    expect(helpStore.open).toBe(true);
    expect(helpStore.topicId).toBe('getting-started');
  });
});
