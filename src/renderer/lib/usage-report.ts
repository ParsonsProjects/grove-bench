/** The ranges the Usage dialog offers, in order. */
export const USAGE_RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'all', label: 'All time', days: null },
] as const;

export type UsageRange = (typeof USAGE_RANGES)[number]['id'];

/** Where a range starts (epoch ms): local midnight, `days - 1` days back,
 *  so "7 days" is today and the six before it. Null for all time. */
export function rangeSince(range: UsageRange, now = Date.now()): number | null {
  const days = USAGE_RANGES.find((r) => r.id === range)?.days ?? null;
  if (days === null) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

/** Agent time as "3h 12m", "12m", "42s" or "0s". */
export function formatAgentTime(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
