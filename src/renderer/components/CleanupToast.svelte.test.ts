import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CleanupToast from './CleanupToast.svelte';
import { cleanupStore } from '../stores/cleanup.svelte.js';

/** Run the store through a clean-up whose threads end as `states` say. */
function runWith(states: Array<'done' | 'failed'>) {
  const items = cleanupStore.start(states.map((_, i) => ({ id: `t${i}`, label: `Thread ${i + 1}`, project: 'repo' })));
  states.forEach((state, i) => {
    items[i].state = state;
    if (state === 'failed') items[i].error = i === 0 ? 'locked' : 'gone';
  });
  cleanupStore.finish();
}

// jsdom has no Web Animations; the toast flies in and out with them (as PlanUsageToast's test).
const realAnimate = Element.prototype.animate;
beforeEach(() => {
  Element.prototype.animate = vi.fn(() => ({ onfinish: null, cancel() {}, finish() {}, currentTime: 0 }) as unknown as Animation);
});

afterEach(() => {
  cleanup();
  Element.prototype.animate = realAnimate;
  vi.useRealTimers();
  cleanupStore.run = null;
  cleanupStore.result = null;
});

describe('CleanupToast', () => {
  it('shows nothing while a run is under way', () => {
    cleanupStore.start([{ id: 't0', label: 'Thread 1', project: 'repo' }]);
    render(CleanupToast);
    expect(screen.queryByTestId('cleanup-toast')).toBeNull();
  });

  it('says how many threads went', () => {
    runWith(['done', 'done', 'done']);
    render(CleanupToast);
    expect(screen.getByTestId('cleanup-toast')).toHaveTextContent('Removed 3 threads');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    runWith(['done']);
    render(CleanupToast);
    expect(screen.getByTestId('cleanup-toast')).toHaveTextContent('Removed 1 thread');
  });

  it('names the threads it could not remove, with why', () => {
    runWith(['done', 'failed']);
    render(CleanupToast);
    const toast = screen.getByTestId('cleanup-toast');
    expect(toast).toHaveTextContent('Removed 1 of 2 threads');
    expect(toast).toHaveTextContent('Couldn\'t remove Thread 2: gone');
    expect(toast).toHaveTextContent('It stays in the list for next time.');
  });

  it('is an alert when none could be removed, and says when the errors differ', () => {
    runWith(['failed', 'failed']);
    render(CleanupToast);
    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Couldn\'t remove 2 threads');
    expect(toast).toHaveTextContent('Couldn\'t remove Thread 1, Thread 2: locked (and other errors)');
    expect(toast).toHaveTextContent('They stay in the list for next time.');
  });

  it('can be dismissed', async () => {
    runWith(['done']);
    render(CleanupToast);
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(cleanupStore.result).toBeNull();
  });

  it('goes after a few seconds, and stays longer when something failed', async () => {
    vi.useFakeTimers();
    runWith(['done']);
    render(CleanupToast);
    await vi.advanceTimersByTimeAsync(6000);
    expect(cleanupStore.result).toBeNull();

    runWith(['failed']);
    await tick();
    await vi.advanceTimersByTimeAsync(6000);
    expect(cleanupStore.result).not.toBeNull();
    await vi.advanceTimersByTimeAsync(6000);
    expect(cleanupStore.result).toBeNull();
  });

  it('a new run clears the last result', () => {
    runWith(['done']);
    cleanupStore.start([{ id: 't9', label: 'Thread 9', project: 'repo' }]);
    expect(cleanupStore.result).toBeNull();
    expect(cleanupStore.running).toBe(true);
    expect(cleanupStore.total).toBe(1);
    expect(cleanupStore.settled).toBe(0);
  });
});
