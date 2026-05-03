import { describe, it, expect } from 'vitest';
import { getDeveloperAppearance } from './developer-appearance.js';

describe('getDeveloperAppearance', () => {
  it('is deterministic — same id → same appearance', () => {
    const a = getDeveloperAppearance('session-abc');
    const b = getDeveloperAppearance('session-abc');
    expect(a).toEqual(b);
  });

  it('returns valid palette values', () => {
    const a = getDeveloperAppearance('session-1');
    expect(a.hairColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.shirtColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.skinTone).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.monitorTint).toMatch(/^#[0-9a-f]{6}$/i);
    expect(['none', 'glasses', 'headphones', 'hat']).toContain(a.accessory);
  });

  it('produces variety across many session ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = getDeveloperAppearance(`session-${i}`);
      seen.add(`${a.hairColor}|${a.shirtColor}|${a.skinTone}|${a.accessory}`);
    }
    // Expect a healthy spread — at least dozens of distinct combinations.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('produces different appearances for different ids (most of the time)', () => {
    const a = getDeveloperAppearance('alpha');
    const b = getDeveloperAppearance('beta');
    const c = getDeveloperAppearance('gamma');
    const sigs = new Set([
      `${a.hairColor}|${a.shirtColor}|${a.accessory}`,
      `${b.hairColor}|${b.shirtColor}|${b.accessory}`,
      `${c.hairColor}|${c.shirtColor}|${c.accessory}`,
    ]);
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('handles empty string without throwing', () => {
    const a = getDeveloperAppearance('');
    expect(a.hairColor).toBeTruthy();
    expect(a.shirtColor).toBeTruthy();
  });
});
