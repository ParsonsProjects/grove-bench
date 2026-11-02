import type { LineRange } from '../lib/worktree-files.js';
import { dockStore } from './dock.svelte.js';

/** State for the Focus panel (one instance, docked in a thread by SideDock). */
class MarkdownPreviewStore {
  open = $state(false);
  title = $state('');
  content = $state('');
  /** The thread the text came from, so images in its worktree show. */
  sessionId = $state<string | undefined>(undefined);
  /** The thread the panel docks in: where it was opened from. The same as
   *  `sessionId`, except for text that isn't read from the worktree (an
   *  attached file), which still opens beside the thread it was clicked in. */
  threadId = $state<string | undefined>(undefined);
  /** The folder its relative links and images are read from: a worktree
   *  file's own (the worktree itself when empty). */
  baseDir = $state('');
  /** Set when `content` is a text file to show as numbered lines rather
   *  than Markdown: its path, and the lines a link pointed at in it. */
  code = $state<{ path: string; lines: LineRange | null } | null>(null);

  show(content: string, title = 'Preview', sessionId?: string, baseDir = '', threadId = sessionId): void {
    this.content = content;
    this.title = title;
    this.sessionId = sessionId;
    this.threadId = threadId;
    this.baseDir = baseDir;
    this.code = null;
    this.open = true;
    dockStore.raise('focus');
  }

  /** Show a text file read-only, scrolled to `lines` when given. */
  showCode(content: string, path: string, sessionId?: string, lines?: LineRange, threadId = sessionId): void {
    this.content = content;
    this.title = path;
    this.sessionId = sessionId;
    this.threadId = threadId;
    this.baseDir = '';
    this.code = { path, lines: lines ?? null };
    this.open = true;
    dockStore.raise('focus');
  }

  close(): void {
    this.open = false;
    dockStore.drop('focus');
  }
}

export const markdownPreviewStore = new MarkdownPreviewStore();
