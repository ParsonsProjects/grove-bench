import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RENDERER = path.resolve(__dirname, '..');
// CI's Windows checkout can give the file CRLF line endings
const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8').replace(/\r\n/g, '\n');

/** The `:root` variables the light theme sets. */
function lightVars(): Map<string, string> {
  const start = css.indexOf('@media (prefers-color-scheme: light) {\n  :root {');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('\n  }\n', start));
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

const HUES = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
/** Shades that read on both backgrounds and need no light override. */
const BOTH = new Set(['600', '700', '800']);

/** A #rrggbb or oklch() colour as linear sRGB. */
function linearRgb(colour: string): number[] {
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  const ok = colour.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/);
  if (hex) {
    return [0, 2, 4].map((i) => {
      const c = parseInt(hex[1].slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  }
  if (ok) {
    // OKLCH to linear sRGB (Björn Ottosson's OKLab matrices)
    const L = Number(ok[1]) / 100, C = Number(ok[2]), h = (Number(ok[3]) * Math.PI) / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => Math.min(1, Math.max(0, v)));
  }
  throw new Error(`Can't read colour ${colour}`);
}

/** WCAG relative luminance of a #rrggbb or oklch() colour, or of linear sRGB. */
function luminance(colour: string | number[]): number {
  const rgb = typeof colour === 'string' ? linearRgb(colour) : colour;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** `top` at `alpha` over `base`, blended in gamma-encoded sRGB as browsers
 *  do, as linear sRGB. */
function over(base: string, top: string, alpha: number): number[] {
  const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [b, t] = [linearRgb(base).map(encode), linearRgb(top).map(encode)];
  return b.map((c, i) => decode(c * (1 - alpha) + t[i] * alpha));
}

function contrast(a: string | number[], b: string | number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('light theme', () => {
  it('has a light shade for every Tailwind palette colour the app uses', () => {
    const vars = lightVars();
    const pattern = new RegExp(`\\b[a-z]+(?:-[a-z]+)*-(${HUES})-(\\d{2,3})\\b`, 'g');
    const missing = new Set<string>();
    for (const file of sourceFiles(RENDERER)) {
      for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
        const name = `--color-${m[1]}-${m[2]}`;
        if (!BOTH.has(m[2]) && !vars.has(name)) missing.add(`${name} (${path.relative(RENDERER, file)})`);
      }
    }
    // Add these to the light block in globals.css (see the comment there)
    expect([...missing]).toEqual([]);
  });

  it('uses only the palette hues the brand gives a meaning', () => {
    // BRAND.md: red fails, amber needs you, yellow and purple and cyan are
    // categories, green acts or is done, blue is in progress or leaves the
    // app. Orange, teal and violet were merged into these; a new hue needs a
    // meaning of its own first.
    const allowed = new Set(['red', 'amber', 'yellow', 'green', 'cyan', 'blue', 'purple']);
    const pattern = new RegExp(`\\b[a-z]+(?:-[a-z]+)*-(${HUES})-\\d{2,3}\\b`, 'g');
    const strays = new Set<string>();
    for (const file of sourceFiles(RENDERER)) {
      for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
        if (!allowed.has(m[1])) strays.add(`${m[0]} (${path.relative(RENDERER, file)})`);
      }
    }
    expect([...strays]).toEqual([]);
  });

  it('keeps text colours at 4.5:1 on the light panels', () => {
    const vars = lightVars();
    const panel = vars.get('--card')!;
    const text = [...vars.keys()].filter((k) => /^--color-[a-z]+-(400|500)$/.test(k));
    text.push('--foreground', '--body-foreground', '--muted-foreground', '--primary', '--destructive', '--link', '--quote-foreground', '--ok',
      '--status-working', '--status-attention', '--status-unread', '--status-error');
    for (const name of text) {
      expect({ name, ok: contrast(vars.get(name)!, panel) >= 4.5 }).toEqual({ name, ok: true });
    }
    // Muted text also sits on the muted background
    expect(contrast(vars.get('--muted-foreground')!, vars.get('--muted')!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps each Notice tone's title at 4.5:1 on its own tinted background", () => {
    const vars = lightVars();
    const colour = (name: string) => vars.get(/-\d+$/.test(name) ? `--color-${name}` : `--${name}`)!;
    const source = readFileSync(path.join(RENDERER, 'lib/components/ui/notice/variants.ts'), 'utf8');
    const tones = [...source.matchAll(/(\w+): \{ root: "[^"]*\bbg-([a-z]+(?:-[a-z]+)*?(?:-\d+)?)\/(\d+)[^"]*", title: "text-([a-z]+-\d+)" \}/g)];
    expect(tones.map((m) => m[1])).toEqual(['info', 'success', 'warning', 'danger']);
    for (const [, tone, bg, alpha, title] of tones) {
      const tint = over(vars.get('--card')!, colour(bg), Number(alpha) / 100);
      expect({ tone, ok: contrast(colour(title), tint) >= 4.5 }).toEqual({ tone, ok: true });
    }
  });
});
