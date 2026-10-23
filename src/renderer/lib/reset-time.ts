/**
 * Format an epoch-seconds reset time as a clock time in the user's locale and
 * timezone. Resets more than a day out include the date so they are
 * unambiguous; resets already in the past read "now".
 */
export function formatResetTime(epochSeconds: number, now = Date.now()): string {
  const reset = new Date(epochSeconds * 1000);
  if (reset.getTime() <= now) return 'now';
  const time = reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return reset.getTime() - now >= 24 * 3600 * 1000
    ? `${reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
    : time;
}
