import type { ChatMessage } from '../stores/messages.svelte.js';
import { isRenderedCopyButton, renderedCode, renderedTable } from './copy-mark.js';
import { isPreviewableMarkdown } from './markdown-detect.js';

/** Text selected inside a pane, and the Activity row the selection starts in
 *  (null outside the Activity thread, e.g. the diff view). */
export interface PaneSelection {
  text: string;
  msgId: string | null;
  range: Range;
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The current selection when it sits inside `container` and isn't blank. */
export function selectionIn(container: Element): PaneSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const msgId = elementOf(range.startContainer)?.closest('[data-msg-id]')?.getAttribute('data-msg-id') ?? null;
  return { text, msgId, range };
}

/** What sits under the pointer when the Activity context menu opens. */
export interface ActivityMenuTarget {
  selection?: { text: string; msgId: string | null };
  /** Source of the code block under the pointer. */
  code?: string;
  /** Table under the pointer: its Markdown source and rendered HTML. */
  table?: { markdown: string; html: string };
  /** href of the link under the pointer. */
  link?: string;
  /** The Activity row under the pointer. */
  message?: ChatMessage;
}

/** Read the menu target from the DOM around `el`. Code blocks and tables are
 *  found through the copy buttons MarkdownBlock renders for them; look-alikes
 *  written as raw HTML in a reply are skipped. */
export function readActivityTarget(
  el: Element,
  container: Element,
  messages: readonly ChatMessage[],
): ActivityMenuTarget {
  const target: ActivityMenuTarget = {};
  const sel = selectionIn(container);
  if (sel) target.selection = { text: sel.text, msgId: sel.msgId };

  const codeBtn = el.closest('.code-block-wrapper')?.querySelector(':scope > .code-copy-btn');
  const code = isRenderedCopyButton(codeBtn) ? renderedCode(codeBtn) : null;
  if (code !== null) target.code = code;

  const tableBtn = el.closest('.table-wrapper')?.querySelector(':scope > .table-copy-btn');
  const table = isRenderedCopyButton(tableBtn) ? renderedTable(tableBtn) : null;
  if (table) target.table = table;

  const href = el.closest('a[href]')?.getAttribute('href');
  if (href) target.link = href;

  const msgId = el.closest('[data-msg-id]')?.getAttribute('data-msg-id');
  const message = msgId ? messages.find((m) => m.id === msgId) : undefined;
  if (message) target.message = message;
  return target;
}

export type ActivityMenuAction =
  | { kind: 'copy'; text: string }
  | { kind: 'copy-rich'; text: string; html: string }
  | { kind: 'bookmark'; text: string; msgId: string | null }
  | { kind: 'to-prompt'; text: string }
  | { kind: 'rewind'; uuid: string }
  | { kind: 'focus'; content: string };

export interface ActivityMenuEntry {
  label: string;
  action: ActivityMenuAction;
  /** Draw a divider above this entry (it starts a new group). */
  separator?: boolean;
}

type Entry = Omit<ActivityMenuEntry, 'separator'>;

const copy = (label: string, text: string): Entry => ({ label, action: { kind: 'copy', text } });

function toolInputField(input: unknown, ...keys: string[]): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] != null && record[key] !== '') return String(record[key]);
  }
  return '';
}

/** Copy actions for a tool call, matching what its hover buttons copy. */
function toolCallEntries(msg: Extract<ChatMessage, { kind: 'tool_call' }>): Entry[] {
  const entries: Entry[] = [];
  const { toolName, toolInput } = msg;
  if (toolName === 'Bash') {
    const command = toolInputField(toolInput, 'command');
    if (command) entries.push(copy('Copy command', command));
  } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') {
    const path = toolInputField(toolInput, 'file_path', 'filePath');
    if (path) entries.push(copy('Copy path', path));
  } else if (toolName === 'Grep' || toolName === 'Glob') {
    const pattern = toolInputField(toolInput, 'pattern');
    if (pattern) entries.push(copy('Copy pattern', pattern));
  } else if (toolInput != null) {
    const json = JSON.stringify(toolInput, null, 2);
    if (json !== '{}') entries.push(copy('Copy input', json));
  }
  if (msg.result) entries.push(copy('Copy output', msg.result));
  return entries;
}

function messageEntries(msg: ChatMessage): Entry[] {
  switch (msg.kind) {
    case 'user': {
      // A message of only attachments has no text to copy.
      const entries = msg.text.trim() ? [copy('Copy message', msg.text)] : [];
      if (msg.uuid) entries.push({ label: 'Rewind to this message', action: { kind: 'rewind', uuid: msg.uuid } });
      return entries;
    }
    case 'text': {
      const entries = [copy('Copy message', msg.text)];
      if (isPreviewableMarkdown(msg.text)) {
        entries.push({ label: 'Read full-width', action: { kind: 'focus', content: msg.text } });
      }
      return entries;
    }
    case 'thinking':
      return [copy('Copy thinking', msg.thinking)];
    case 'system':
    case 'error':
      return [copy('Copy message', msg.text)];
    case 'tool_call':
      return toolCallEntries(msg);
    default:
      return [];
  }
}

/** Menu entries for a target, most specific first: the selection, then the
 *  code block, table or link under the pointer, then the whole row. */
export function activityMenuEntries(target: ActivityMenuTarget): ActivityMenuEntry[] {
  const groups: Entry[][] = [];
  if (target.selection) {
    const { text, msgId } = target.selection;
    groups.push([
      copy('Copy', text),
      { label: 'Bookmark selection', action: { kind: 'bookmark', text, msgId } },
      { label: 'Copy to prompt', action: { kind: 'to-prompt', text } },
    ]);
  }
  const element: Entry[] = [];
  if (target.code !== undefined) element.push(copy('Copy code', target.code));
  if (target.table) {
    const { markdown, html } = target.table;
    element.push({ label: 'Copy table', action: { kind: 'copy-rich', text: markdown, html } });
  }
  if (target.link) element.push(copy('Copy link', target.link));
  groups.push(element);
  if (target.message) groups.push(messageEntries(target.message));

  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, g) => group.map((entry, i) => (g > 0 && i === 0 ? { ...entry, separator: true } : entry)));
}
