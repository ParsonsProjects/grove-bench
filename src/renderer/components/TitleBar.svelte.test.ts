import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import TitleBar from './TitleBar.svelte';

const bridge = mockGroveBench as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete bridge.winIsMaximized;
  delete bridge.onUpdateStatus;
});

describe('TitleBar', () => {
  it('asks main whether the window is maximized once a resize settles, not per event', async () => {
    vi.useFakeTimers();
    const isMaximized = vi.fn().mockResolvedValue(false);
    bridge.winIsMaximized = isMaximized;
    bridge.onUpdateStatus = () => () => {};
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
