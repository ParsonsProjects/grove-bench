/** What to show for anything thrown or rejected with: its message, else the
 *  value itself as text (an Error with no message reads as its name). */
export function errorMessage(e: unknown): string {
  return String((e as { message?: unknown } | null)?.message || e);
}
