import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalColors, prefersLight, onColorSchemeChange } from './terminal-theme.js';

/** A matchMedia whose light/dark answer the test can flip. */
function fakeMatchMedia(light: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return light; },
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    listeners,
    flip(next: boolean) {
      light = next;
      for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('terminal theme', () => {
  it('raises contrast in light only, and keeps the dark colours as they were', () => {
    expect(terminalColors(true)).toMatchObject({ minimumContrastRatio: 4.5, theme: { background: '#ffffff' } });
    expect(terminalColors(false)).toMatchObject({ minimumContrastRatio: 1, theme: { background: '#1f1f1f' } });
  });

  it('reads the colour scheme, and assumes dark without matchMedia', () => {
    fakeMatchMedia(true);
    expect(prefersLight()).toBe(true);
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersLight()).toBe(false);
  });

  it('reports scheme changes until stopped', () => {
    const media = fakeMatchMedia(false);
    const seen: boolean[] = [];
    const stop = onColorSchemeChange((light) => seen.push(light));

    media.flip(true);
    media.flip(false);
    stop();
    media.flip(true);
    expect(seen).toEqual([true, false]);
    expect(media.listeners.size).toBe(0);
  });
});
