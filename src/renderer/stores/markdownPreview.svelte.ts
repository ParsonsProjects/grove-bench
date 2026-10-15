/** State for the global markdown preview slide-out (one instance, mounted in App). */
class MarkdownPreviewStore {
  open = $state(false);
  title = $state('');
  content = $state('');
  /** The thread the text came from, so images in its worktree show. */
  sessionId = $state<string | undefined>(undefined);
  /** The folder its relative links and images are read from: a worktree
   *  file's own (the worktree itself when empty). */
  baseDir = $state('');

  show(content: string, title = 'Preview', sessionId?: string, baseDir = ''): void {
    this.content = content;
    this.title = title;
    this.sessionId = sessionId;
    this.baseDir = baseDir;
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

export const markdownPreviewStore = new MarkdownPreviewStore();
