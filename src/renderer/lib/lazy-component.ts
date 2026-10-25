/**
 * Load a component's code the first time it's wanted, then reuse it. For
 * panels and dialogs that open on demand, so their code (and what only they
 * import) stays out of the bundle parsed at startup. Use the returned
 * function in an `{#await}` block where the component is shown (a workspace
 * tab: LazyTab). A load that fails stays failed: Chromium keeps a failed
 * import for the life of the page, so asking again doesn't fetch the file.
 */
export function lazyComponent<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load().then((m) => m.default));
}
