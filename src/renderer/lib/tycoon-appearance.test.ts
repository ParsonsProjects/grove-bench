import { describe, it, expect } from 'vitest';
import {
  buildSprite,
  developerAppearance,
  hashString,
  SKIN_TONES,
  HAIR_COLORS,
  SHIRT_COLORS,
  SPRITE_COLS,
  SPRITE_ROWS,
} from './tycoon-appearance.js';

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc-123')).toBe(hashString('abc-123'));
  });

  it('differs for different inputs', () => {
    expect(hashString('session-a')).not.toBe(hashString('session-b'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashString('anything');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('developerAppearance', () => {
  it('is stable for the same session id', () => {
    expect(developerAppearance('wt-abc123')).toEqual(developerAppearance('wt-abc123'));
  });

  it('only uses colors from the palettes', () => {
    for (let i = 0; i < 50; i++) {
      const a = developerAppearance(`session-${i}`);
      expect(SKIN_TONES).toContain(a.skin);
      expect(HAIR_COLORS).toContain(a.hair);
      expect(SHIRT_COLORS).toContain(a.shirt);
      expect(SHIRT_COLORS).toContain(a.capColor);
    }
  });

  it('produces variety across many session ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const a = developerAppearance(`session-${i}`);
      seen.add(`${a.skin}|${a.hair}|${a.hairStyle}|${a.shirt}|${a.accessory}`);
    }
    // 100 ids should hit well over 50 distinct combinations
    expect(seen.size).toBeGreaterThan(50);
  });

  it('varies attributes independently (not all driven by one hash)', () => {
    const styles = new Set<string>();
    const accessories = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const a = developerAppearance(`session-${i}`);
      styles.add(a.hairStyle);
      accessories.add(a.accessory);
    }
    expect(styles.size).toBeGreaterThan(1);
    expect(accessories.size).toBeGreaterThan(1);
  });
});

describe('buildSprite', () => {
  it('is deterministic for the same appearance', () => {
    const a = developerAppearance('wt-xyz');
    expect(buildSprite(a)).toEqual(buildSprite(a));
  });

  it('keeps all pixels inside the grid', () => {
    for (let i = 0; i < 20; i++) {
      for (const p of buildSprite(developerAppearance(`s-${i}`))) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(SPRITE_COLS);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(SPRITE_ROWS);
      }
    }
  });

  it('always contains skin and shirt pixels', () => {
    for (let i = 0; i < 20; i++) {
      const a = developerAppearance(`s-${i}`);
      const colors = new Set(buildSprite(a).map((p) => p.color));
      expect(colors).toContain(a.skin);
      expect(colors).toContain(a.shirt);
    }
  });

  it('renders each accessory distinctly', () => {
    const base = developerAppearance('any');
    const variants = (['none', 'glasses', 'headphones', 'cap'] as const).map((accessory) =>
      JSON.stringify(buildSprite({ ...base, accessory })),
    );
    expect(new Set(variants).size).toBe(4);
  });
});
