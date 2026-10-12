import { describe, expect, it } from 'vitest';
import { cn, tv } from './utils.js';

describe('cn and tv', () => {
  // text-micro and text-caption are font sizes from globals.css that
  // tailwind-merge doesn't know; without the config it reads them as colours.
  it('keeps the theme font sizes next to a text colour', () => {
    expect(cn('text-micro text-muted-foreground')).toBe('text-micro text-muted-foreground');
    expect(cn('text-caption', 'text-status-working')).toBe('text-caption text-status-working');
  });

  it('lets a later font size replace an earlier one', () => {
    expect(cn('text-xs', 'text-micro')).toBe('text-micro');
    expect(cn('text-micro', 'text-sm')).toBe('text-sm');
  });

  it('applies the same rules inside tv', () => {
    const v = tv({ base: 'text-xs text-foreground', variants: { size: { tiny: 'text-micro' } } });
    expect(v({ size: 'tiny', class: 'text-muted-foreground' })).toBe('text-micro text-muted-foreground');
  });
});
