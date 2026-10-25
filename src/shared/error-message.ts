/** What to show for anything thrown or rejected with: its message, else
 *  `fallback`, else the value itself as text (an Error with no message reads
 *  as its name). */
export function errorMessage(e: unknown, fallback?: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  return message ? String(message) : fallback ?? String(e);
}
