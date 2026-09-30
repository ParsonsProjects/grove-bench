import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import TitleBar from './TitleBar.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
