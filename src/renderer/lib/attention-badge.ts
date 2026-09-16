/**
 * Taskbar badge: how many sessions need the user right now.
 *
 * "Needs attention" is the union of the triage states the user has to act
 * on — blocked on a permission/question ("needs you") or finished while
 * unfocused ("unread"). Completed sessions are excluded, matching the
 * sidebar's default view.
 */

export interface BadgeSession {
  id: string;
  completedAt?: number | null;
}

export function attentionCount(
  sessions: readonly BadgeSession[],
  needsInput: (id: string) => boolean,
  unread: (id: string) => boolean,
): number {
  let n = 0;
  for (const s of sessions) {
    if (s.completedAt) continue;
    if (needsInput(s.id) || unread(s.id)) n++;
  }
  return n;
}

/** Text drawn inside the badge. Two digits is all a 16px overlay can show. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/**
 * Draw the overlay bitmap (a red disc with the count) as a PNG data URL.
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
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    const text = badgeText(count);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${text.length > 1 ? Math.round(size * 0.55) : Math.round(size * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + size * 0.04);
    const url = canvas.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}
