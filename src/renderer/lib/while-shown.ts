/**
 * A value a hidden view doesn't keep up to date. Every live thread's pane
 * stays mounted (App.svelte), hidden but for the open one, and its views
 * went over the whole thread again on every message the agent sent:
 * working out the chat, drawing it into hidden rows, recounting what the
 * view mode hides. In a test with ten threads working out of sight, that
 * took about twenty times as long as taking their messages in.
 *
 * Pass the result to `$derived.by`. While `shown()` holds it gives `read()`;
 * hidden, it gives what `read()` gave when last shown (or first asked), and
 * the derived depends on `shown()` alone, so changes to what `read()` reads
 * don't run it or anything drawn from it. Shown again, it reads afresh at
 * once: a derived is worked out when read, so the view is never behind
 * while it shows, even just after an await.
 */
export function whileShown<T>(shown: () => boolean, read: () => T): () => T {
  let last: { value: T } | null = null;
  return () => {
    if (shown() || !last) last = { value: read() };
    return last.value;
  };
}
