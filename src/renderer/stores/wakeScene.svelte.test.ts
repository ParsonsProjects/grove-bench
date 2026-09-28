import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../__mocks__/setup.js';

import { wakeScene } from './wakeScene.svelte.js';
import { settingsStore } from './settings.svelte.js';
import { WAKE_SCENE_MS } from '../lib/grove-walk.js';

function reducedMotion(on: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: on }) as MediaQueryList);
}

beforeEach(() => {
  vi.useFakeTimers();
  settingsStore.current.groveCharacters = true;
  reducedMotion(false);
});

afterEach(() => {
  wakeScene.end();
  vi.useRealTimers();
});

describe('wakeScene', () => {
  it('plays for the conversation it was started for, then ends by itself', () => {
    wakeScene.start('s1', 'sleeping');
    expect(wakeScene.for('s1')).toMatchObject({ sessionId: 's1', from: 'sleeping' });
    expect(wakeScene.for('s2')).toBeNull();

    vi.advanceTimersByTime(WAKE_SCENE_MS - 1);
    expect(wakeScene.for('s1')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(wakeScene.current).toBeNull();
  });

  it('ends early when skipped', () => {
    wakeScene.start('s1', 'stopped');
    wakeScene.end();
    expect(wakeScene.current).toBeNull();
  });

  it('plays one scene at a time, and a new one gets its own full length', () => {
    wakeScene.start('s1', 'sleeping');
    vi.advanceTimersByTime(WAKE_SCENE_MS - 100);
    wakeScene.start('s2', 'stopped');
    expect(wakeScene.for('s1')).toBeNull();

    vi.advanceTimersByTime(200);
    expect(wakeScene.for('s2')).not.toBeNull();
  });

  it('does not play with grove characters off', () => {
    settingsStore.current.groveCharacters = false;
    wakeScene.start('s1', 'sleeping');
    expect(wakeScene.current).toBeNull();
  });

  it('does not play for reduced motion, where it would only delay the chat', () => {
    reducedMotion(true);
    wakeScene.start('s1', 'sleeping');
    expect(wakeScene.current).toBeNull();
  });
});
