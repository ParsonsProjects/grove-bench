/**
 * One colour scale for "how full": the context meter in the status bar, its
 * Remaining figure, the context grove's seasons (context-grove.ts), and the
 * plan usage bars in Agent settings. The table in docs/help/status-bar.md
 * describes the same steps.
 */
export type UsageTone = 'ok' | 'filling' | 'low' | 'full';

/** Tone for a percentage used (0 to 100). */
export function usageTone(percent: number): UsageTone {
  if (percent > 85) return 'full';
  if (percent > 70) return 'low';
  if (percent > 40) return 'filling';
  return 'ok';
}

const TEXT: Record<UsageTone, string> = {
  ok: 'text-green-400',
  filling: 'text-yellow-400',
  low: 'text-orange-400',
  full: 'text-red-400',
};

const BAR: Record<UsageTone, string> = {
  ok: 'bg-green-500',
  filling: 'bg-yellow-400',
  low: 'bg-orange-400',
  full: 'bg-red-400',
};

export function usageTextClass(percent: number): string {
  return TEXT[usageTone(percent)];
}

export function usageBarClass(percent: number): string {
  return BAR[usageTone(percent)];
}
