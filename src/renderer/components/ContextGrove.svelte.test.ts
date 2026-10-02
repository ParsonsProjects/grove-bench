import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

import ContextGrove from './ContextGrove.svelte';
import { GROVE_GROW_MS, groveLayout, groveRuns, grovePaths, groveSweepMs } from '../lib/context-grove.js';

const SEED = 'conv-1';
const drawn = (el: HTMLElement) => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('');
const settledAt = (percent: number) => grovePaths(groveRuns(groveLayout(SEED), percent)).map((p) => p.d).join('');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ContextGrove', () => {
  it('jumps straight to the new amount when not animating', async () => {
    const { getByTestId, rerender } = render(ContextGrove, { props: { seed: SEED, percent: 0 } });
    // A few small plants stand before any context is used.
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(0));
    expect(settledAt(0)).not.toBe('');
    await rerender({ seed: SEED, percent: 50 });
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(50));
  });

  it('grows into the new amount when animating', async () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(ContextGrove, { props: { seed: SEED, percent: 20, animate: false } });
    await rerender({ seed: SEED, percent: 20, animate: true });
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(20));

    await rerender({ seed: SEED, percent: 50, animate: true });
    await vi.advanceTimersByTimeAsync(groveSweepMs(30) / 2);
    await tick();
    const mid = drawn(getByTestId('context-grove'));
    expect(mid).not.toBe(settledAt(20));
    expect(mid).not.toBe(settledAt(50));

    await vi.advanceTimersByTimeAsync(groveSweepMs(30) + GROVE_GROW_MS);
    await tick();
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(50));
  });

  it('finishes straight away when it stops animating (the conversation is hidden)', async () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(ContextGrove, { props: { seed: SEED, percent: 20, animate: true } });
    await vi.advanceTimersByTimeAsync(groveSweepMs(20) + GROVE_GROW_MS);
    await rerender({ seed: SEED, percent: 60, animate: true });
    await vi.advanceTimersByTimeAsync(200);
    await rerender({ seed: SEED, percent: 60, animate: false });
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(60));
  });

  it('does not animate with reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }) as MediaQueryList);
    const { getByTestId, rerender } = render(ContextGrove, { props: { seed: SEED, percent: 0, animate: true } });
    await rerender({ seed: SEED, percent: 50, animate: true });
    expect(drawn(getByTestId('context-grove'))).toBe(settledAt(50));
  });
});
