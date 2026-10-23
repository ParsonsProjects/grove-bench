/**
 * The Help panel: whether it's open, and at which topic. Opened from the
 * title bar's "?", F1, or a link elsewhere in the app.
 */
class HelpStore {
  open = $state(false);
  /** Topic to show when opening; null keeps the last one viewed. */
  topicId = $state<string | null>(null);

  show(topicId?: string): void {
    this.topicId = topicId ?? null;
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

export const helpStore = new HelpStore();
