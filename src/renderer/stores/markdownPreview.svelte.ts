/** State for the global markdown preview slide-out (one instance, mounted in App). */
class MarkdownPreviewStore {
  open = $state(false);
  title = $state('');
  content = $state('');

  show(content: string, title = 'Preview'): void {
    this.content = content;
    this.title = title;
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

export const markdownPreviewStore = new MarkdownPreviewStore();
