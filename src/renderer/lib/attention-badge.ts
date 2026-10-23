import { FONTS, PALETTE } from '../../shared/brand.js';

/**
 * Taskbar badge: how many sessions need the user right now.
 *
 * "Needs attention" is the union of the triage states the user has to act
 * on — blocked on a permission/question ("needs you") or finished while
 * unfocused ("unread").
 */

export interface BadgeSession {
  id: string;
}

export function attentionCount<S extends BadgeSession>(
  sessions: readonly S[],
  needsInput: (session: S) => boolean,
  unread: (session: S) => boolean,
): number {
  let n = 0;
  for (const s of sessions) {
    if (needsInput(s) || unread(s)) n++;
  }
  return n;
}

/** Text drawn inside the badge. Two digits is all a 16px overlay can show. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/**
 * Draw the overlay bitmap as a PNG data URL: the count on a square in the
 * brand's "needs you" amber, square like the rest of the app (BRAND.md).
 * Returns null when canvas is unavailable (tests, headless), in which case
 * main falls back to a text badge where the platform has one.
 */
export function renderBadgeDataUrl(count: number, size = 32): string | null {
  if (count <= 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = PALETTE.sun;
    ctx.fillRect(0, 0, size, size);
    const text = badgeText(count);
    // Dark text on amber: white would be 2.2:1
    ctx.fillStyle = PALETTE.canopy;
    ctx.font = `bold ${text.length > 1 ? Math.round(size * 0.55) : Math.round(size * 0.7)}px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + size * 0.04);
    const url = canvas.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}
