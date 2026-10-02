/**
 * The memory compaction timeout (`memoryCompactTimeoutSeconds`). One rule,
 * used by the settings schema, compaction itself and the Memory panel, so
 * what Settings shows is what compaction uses.
 */

/** Below this no pass could finish. */
export const MEMORY_COMPACT_MIN_TIMEOUT_SECONDS = 30;
/** An hour. Also keeps the timer well inside what setTimeout can schedule
 *  (about 24.8 days; longer delays fire after 1 ms). */
export const MEMORY_COMPACT_MAX_TIMEOUT_SECONDS = 3600;
/** For an unset, zero or invalid value. */
export const MEMORY_COMPACT_DEFAULT_TIMEOUT_SECONDS = 300;

/** The timeout compaction uses for a saved value: the default when it isn't
 *  a positive number, otherwise rounded to a whole second and kept in range. */
export function effectiveCompactTimeoutSeconds(saved: number | null | undefined): number {
  const seconds = typeof saved === 'number' && Number.isFinite(saved) && saved > 0
    ? Math.round(saved)
    : MEMORY_COMPACT_DEFAULT_TIMEOUT_SECONDS;
  return Math.min(MEMORY_COMPACT_MAX_TIMEOUT_SECONDS, Math.max(MEMORY_COMPACT_MIN_TIMEOUT_SECONDS, seconds));
}
