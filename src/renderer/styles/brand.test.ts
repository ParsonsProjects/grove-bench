import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FONTS, NIGHT, PALETTE, PAPER, STATUS } from '../../shared/brand.js';

// CI's Windows checkout can give the file CRLF line endings
const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8').replace(/\r\n/g, '\n');

function vars(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** The dark theme: the first `:root` block. */
function darkVars(): Map<string, string> {
  const start = css.indexOf(':root {');
  return vars(css.slice(start, css.indexOf('\n}\n', start)));
}

/** The light theme: the `:root` inside the prefers-color-scheme block. */
function lightVars(): Map<string, string> {
  const start = css.indexOf('@media (prefers-color-scheme: light) {\n  :root {');
  return vars(css.slice(start, css.indexOf('\n  }\n', start)));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('brand', () => {
  it('builds the dark theme from the brand colours', () => {
    const v = darkVars();
    expect({
      background: v.get('--background'),
      foreground: v.get('--foreground'),
      card: v.get('--card'),
      muted: v.get('--muted'),
      mutedForeground: v.get('--muted-foreground'),
      border: v.get('--border'),
      input: v.get('--input'),
      sidebar: v.get('--sidebar'),
      accent: v.get('--accent'),
      primary: v.get('--primary'),
      primaryForeground: v.get('--primary-foreground'),
      destructive: v.get('--destructive'),
      link: v.get('--link'),
    }).toEqual({
      background: NIGHT.background,
      foreground: NIGHT.foreground,
      card: NIGHT.card,
      muted: NIGHT.muted,
      mutedForeground: NIGHT.mutedForeground,
      border: NIGHT.border,
      input: NIGHT.input,
      sidebar: NIGHT.sidebar,
      accent: NIGHT.accent,
      primary: PALETTE.leaf,
      primaryForeground: PALETTE.canopy,
      destructive: PALETTE.ember,
      link: PALETTE.sky,
    });
  });

  it('builds the light theme from the brand colours', () => {
    const v = lightVars();
    expect({
      background: v.get('--background'),
      foreground: v.get('--foreground'),
      card: v.get('--card'),
      muted: v.get('--muted'),
      mutedForeground: v.get('--muted-foreground'),
      border: v.get('--border'),
      input: v.get('--input'),
      accent: v.get('--accent'),
      primary: v.get('--primary'),
      destructive: v.get('--destructive'),
      link: v.get('--link'),
    }).toEqual({
      background: PAPER.background,
      foreground: PAPER.foreground,
      card: PAPER.card,
      muted: PAPER.muted,
      mutedForeground: PAPER.mutedForeground,
      border: PAPER.border,
      input: PAPER.input,
      accent: PAPER.accent,
      primary: PALETTE.forest,
      destructive: PALETTE.emberDeep,
      link: PALETTE.skyDeep,
    });
  });

  it('gives each status its brand colour in both themes', () => {
    const dark = darkVars();
    const light = lightVars();
    for (const [tone, colours] of Object.entries(STATUS)) {
      expect({ tone, dark: dark.get(`--status-${tone}`), light: light.get(`--status-${tone}`) })
        .toEqual({ tone, dark: colours.dark, light: colours.light });
    }
  });

  it('sets the theme fonts from the brand', () => {
    const theme = vars(css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {'))));
    expect(theme.get('--font-mono')).toBe(FONTS.mono);
    expect(theme.get('--font-pixel')).toBe(FONTS.pixel);
  });

  it('keeps text at 4.5:1 on the dark panels', () => {
    const v = darkVars();
    const text = ['--foreground', '--muted-foreground', '--primary', '--destructive', '--link',
      '--status-working', '--status-attention', '--status-unread', '--status-error'];
    for (const name of text) {
      for (const surface of ['--background', '--card']) {
        expect({ name, surface, ok: contrast(v.get(name)!, v.get(surface)!) >= 4.5 }).toEqual({ name, surface, ok: true });
      }
    }
    expect(contrast(v.get('--muted-foreground')!, v.get('--muted')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.get('--sidebar-foreground')!, v.get('--sidebar')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps button text at 4.5:1 on the primary and destructive fills in both themes', () => {
    const dark = darkVars();
    const light = lightVars();
    for (const theme of [dark, light]) {
      expect(contrast(theme.get('--primary-foreground')!, theme.get('--primary')!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.get('--destructive-foreground')!, theme.get('--destructive')!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(dark.get('--destructive-foreground')).toBe(PALETTE.cinder);
  });
});
