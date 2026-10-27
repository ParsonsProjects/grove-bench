import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import DraftUndoToast from './DraftUndoToast.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  store.repos = ['/repo/one'];
  store.activeSessionId = null;
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  draftStore.discard();
  draftStore.discarded = null;
  store.repos = [];
});

describe('DraftUndoToast', () => {
  it('brings back a draft discarded with a message', async () => {
    draftStore.setText('Fix the crash');
    draftStore.discardWithUndo();
    render(DraftUndoToast);
    expect(screen.getByRole('status')).toHaveTextContent('Draft discarded.');
    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(draftStore.draft?.text).toBe('Fix the crash');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes after a few seconds', async () => {
    vi.useFakeTimers();
    draftStore.setText('Fix the crash');
    draftStore.discardWithUndo();
    render(DraftUndoToast);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(8000);
    expect(screen.queryByRole('status')).toBeNull();
    expect(draftStore.discarded).toBeNull();
  });

  it('shows nothing for an empty draft', () => {
    draftStore.discardWithUndo();
    render(DraftUndoToast);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
