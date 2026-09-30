import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import TitleBar from './TitleBar.svelte';
import FirstSteps from './FirstSteps.svelte';
import { helpStore } from '../stores/help.svelte.js';
import { store } from '../stores/sessions.svelte.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  helpStore.close();
  store.repos = [];
});

describe('TitleBar', () => {
  it('asks main whether the window is maximized once a resize settles, not per event', async () => {
    vi.useFakeTimers();
    const isMaximized = mockGroveBench.winIsMaximized;
    isMaximized.mockClear();
    render(TitleBar);
    expect(isMaximized).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(isMaximized).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(isMaximized).toHaveBeenCalledTimes(2);
  });
});

describe('Help', () => {
  // Help loads on first open. Load it here once, since transforming it cold
  // takes several seconds, longer than a test waits for the dialog.
  beforeAll(async () => { await import('./HelpPanel.svelte'); }, 30_000);

  it('opens with F1 from anywhere', async () => {
    render(TitleBar);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'F1' });
    expect(helpStore.open).toBe(true);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens with F1 even when a focused element (the terminal) stops the key', async () => {
    render(TitleBar);
    const input = document.createElement('textarea');
    input.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: 'F1' });
    expect(helpStore.open).toBe(true);
    input.remove();
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
