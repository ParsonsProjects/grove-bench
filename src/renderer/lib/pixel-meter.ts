/** One block of a pixel meter: lit, started (the percent falls inside it), or empty. */
export type MeterCell = 'full' | 'part' | 'empty';

/**
 * A percentage (0 to 100) as a row of `count` blocks, each an equal share. A
 * block is full once the percent reaches its end, and part-lit while the
 * percent is inside it, so any use at all shows.
 */
export function meterCells(percent: number, count: number): MeterCell[] {
  const share = 100 / count;
  return Array.from({ length: count }, (_, i) => {
    if (percent >= (i + 1) * share) return 'full';
    if (percent > i * share) return 'part';
    return 'empty';
  });
}
