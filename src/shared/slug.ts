/** `text` as lowercase letters, digits and dashes, for ids made from names
 *  the user types. Empty when nothing usable is left. */
export function slugify(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
