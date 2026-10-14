import { describe, it, expect } from 'vitest';
import { isSafeMode, SAFE_MODE_FLAG } from './safe-mode.js';

describe('isSafeMode', () => {
  it('is on only when the command line has --safe-mode', () => {
    expect(SAFE_MODE_FLAG).toBe('--safe-mode');
    expect(isSafeMode(['C:\\Grove Bench\\Grove Bench.exe', '--safe-mode'])).toBe(true);
    expect(isSafeMode(['electron.exe', 'dist/main/index.js', '--safe-mode'])).toBe(true);
    expect(isSafeMode(['C:\\Grove Bench\\Grove Bench.exe'])).toBe(false);
    expect(isSafeMode(['Grove Bench.exe', '--safe-modes', 'safe-mode'])).toBe(false);
  });
});
