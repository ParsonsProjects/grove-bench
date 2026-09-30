/**
 * Load a component's code the first time it's wanted, then reuse it. For
 * panels and dialogs that open on demand, so their code (and what only they
 * import) stays out of the bundle parsed at startup. Use the returned
 * function in an `{#await}` block where the component is shown.
 */
export function lazyComponent<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load().then((m) => m.default));
}
