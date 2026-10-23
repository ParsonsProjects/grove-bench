import type { LineRange } from '../lib/worktree-files.js';

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
  /** Set when `content` is a text file to show as numbered lines rather
   *  than Markdown: its path, and the lines a link pointed at in it. */
  code = $state<{ path: string; lines: LineRange | null } | null>(null);

  show(content: string, title = 'Preview', sessionId?: string, baseDir = ''): void {
    this.content = content;
    this.title = title;
    this.sessionId = sessionId;
    this.baseDir = baseDir;
    this.code = null;
    this.open = true;
  }

  /** Show a text file read-only, scrolled to `lines` when given. */
  showCode(content: string, path: string, sessionId?: string, lines?: LineRange): void {
    this.content = content;
    this.title = path;
    this.sessionId = sessionId;
    this.baseDir = '';
    this.code = { path, lines: lines ?? null };
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

export const markdownPreviewStore = new MarkdownPreviewStore();
