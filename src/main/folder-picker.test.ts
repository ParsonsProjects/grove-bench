import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FOLDER_CHECK_MS, projectPickerStart } from './folder-picker.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('projectPickerStart', () => {
  it('opens next to the last project when its folder is there', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-picker-'));
    try {
      expect(await projectPickerStart(path.join(parent, 'repo'), '/home')).toBe(parent);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('opens in home with no project, or when its folder is gone', async () => {
    expect(await projectPickerStart(null, '/home')).toBe('/home');
    expect(await projectPickerStart(path.join(os.tmpdir(), 'grove-picker-gone', 'x', 'repo'), '/home')).toBe('/home');
  });

  it("opens in home without waiting for a folder that doesn't answer, and checks it only once", async () => {
    vi.useFakeTimers();
    const stat = vi.fn(() => new Promise<never>(() => {})) as unknown as typeof fs.promises.stat;

    // A project on a network share that's offline: its stat never settles.
    const onShare = path.join(path.sep, 'offline-share', 'code', 'repo');
    const first = projectPickerStart(onShare, '/home', { stat });
    const second = projectPickerStart(onShare, '/home', { stat });
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_MS);

    expect(await first).toBe('/home');
    expect(await second).toBe('/home');
    expect(stat).toHaveBeenCalledOnce();
  });
});
