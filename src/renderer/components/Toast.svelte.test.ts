import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { store } from '../stores/sessions.svelte.js';

import Toast from './Toast.svelte';
import ErrorToast from './ErrorToast.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  store.setError(null);
});

describe('Toast', () => {
  it('goes after its time, or on its button', async () => {
    vi.useFakeTimers();
    const ondismiss = vi.fn();
    render(Toast, { text: 'Saved', ondismiss, timeout: 1000 });

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    vi.advanceTimersByTime(999);
    expect(ondismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ondismiss).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(ondismiss).toHaveBeenCalledTimes(2);
  });

  it('keeps its pointerdowns from what is under it (a dialog that would close)', async () => {
    const onPointerDown = vi.fn();
    const { container } = render(Toast, { text: 'Saved', ondismiss: () => {} });
    document.addEventListener('pointerdown', onPointerDown);

    await fireEvent.pointerDown(container.querySelector('[role=presentation]')!);
    expect(onPointerDown).not.toHaveBeenCalled();
    document.removeEventListener('pointerdown', onPointerDown);
  });
});

describe('ErrorToast', () => {
  it('shows the app error as an alert, and clears it', async () => {
    render(ErrorToast);
    store.setError('Something broke');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(store.error).toBeNull();
  });
});
