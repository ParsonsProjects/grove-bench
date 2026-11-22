/**
 * How long ago a timestamp was: short for the UI ("3h ago"), or `long` for
 * text an agent reads ("3 hours ago"). `now` defaults to the clock.
 */
export function formatAge(timestamp: number, opts: { now?: number; long?: boolean } = {}): string {
  if (!timestamp) return '';

  const diffMs = (opts.now ?? Date.now()) - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const ago = (n: number, short: string, long: string) =>
    opts.long ? `${n} ${long}${n === 1 ? '' : 's'} ago` : `${n}${short} ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return ago(diffMin, 'm', 'minute');

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return ago(diffHrs, 'h', 'hour');

  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return ago(diffDays, 'd', 'day');

  return ago(Math.floor(diffDays / 30), 'mo', 'month');
}
