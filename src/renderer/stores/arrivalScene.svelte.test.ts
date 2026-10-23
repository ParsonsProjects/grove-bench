import { describe, it, expect, afterEach, vi } from 'vitest';

import { arrivalScene } from './arrivalScene.svelte.js';

afterEach(() => {
  arrivalScene.end('s1');
  arrivalScene.end('s2');
  vi.useRealTimers();
});

describe('arrivalScene', () => {
  it('keeps when each conversation\'s scene began', () => {
    vi.useFakeTimers({ now: 1000 });
    arrivalScene.begin('s1');
    vi.setSystemTime(5000);
    arrivalScene.begin('s2');
    expect(arrivalScene.for('s1')).toBe(1000);
    expect(arrivalScene.for('s2')).toBe(5000);
  });

  it('carries on rather than starting over when begun again', () => {
    vi.useFakeTimers({ now: 1000 });
    arrivalScene.begin('s1');
    vi.setSystemTime(2000);
    arrivalScene.begin('s1');
    expect(arrivalScene.for('s1')).toBe(1000);
  });

  it('ends for one conversation only', () => {
    arrivalScene.begin('s1');
    arrivalScene.begin('s2');
    arrivalScene.end('s1');
    expect(arrivalScene.for('s1')).toBeNull();
    expect(arrivalScene.for('s2')).not.toBeNull();
    // Ending one that isn't playing is fine.
    arrivalScene.end('s1');
  });
});
