/**
 * Load a component's code the first time it's wanted, then reuse it. For
 * panels and dialogs that open on demand, so their code (and what only they
 * import) stays out of the bundle parsed at startup. Use the returned
 * function in an `{#await}` block where the component is shown (a workspace
 * tab: LazyTab). A load that fails is forgotten, so the next ask tries again.
 */
export function lazyComponent<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load().then(
    (m) => m.default,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));
}
