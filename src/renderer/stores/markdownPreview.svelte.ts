/** State for the global markdown preview slide-out (one instance, mounted in App). */
class MarkdownPreviewStore {
  open = $state(false);
  title = $state('');
  content = $state('');
  /** The thread the text came from, so images in its worktree show. */
  sessionId = $state<string | undefined>(undefined);

  show(content: string, title = 'Preview', sessionId?: string): void {
    this.content = content;
    this.title = title;
    this.sessionId = sessionId;
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

export const markdownPreviewStore = new MarkdownPreviewStore();
