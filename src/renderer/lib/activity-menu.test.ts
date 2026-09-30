import { describe, it, expect } from 'vitest';
import { activityMenuEntries } from './activity-menu.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

const labels = (entries: ReturnType<typeof activityMenuEntries>) => entries.map((e) => e.label);

function toolCall(toolName: string, toolInput: unknown, result?: string): ChatMessage {
  return { kind: 'tool_call', id: 't', toolName, toolInput, toolUseId: 'u', uuid: '', pending: false, result };
}

describe('activityMenuEntries', () => {
  it('is empty when nothing under the pointer has an action', () => {
    expect(activityMenuEntries({})).toEqual([]);
    expect(activityMenuEntries({ message: { kind: 'result', id: 'r' } as ChatMessage })).toEqual([]);
  });

  it('lists the selection first, then the element, then the row, with a divider between groups', () => {
    const entries = activityMenuEntries({
      selection: { text: 'picked', msgId: 'm1' },
      code: 'const a = 1;',
      message: { kind: 'user', id: 'm1', text: 'prompt', uuid: 'uuid-1' },
    });
    expect(labels(entries)).toEqual([
      'Copy', 'Bookmark selection', 'Copy to prompt',
      'Copy code',
      'Copy message', 'Rewind to this message',
    ]);
    expect(entries.filter((e) => e.separator).map((e) => e.label)).toEqual(['Copy code', 'Copy message']);
    expect(entries[1].action).toEqual({ kind: 'bookmark', text: 'picked', msgId: 'm1' });
    expect(entries[5].action).toEqual({ kind: 'rewind', uuid: 'uuid-1' });
  });

  it('copies a table as Markdown plus HTML', () => {
    const [entry] = activityMenuEntries({ table: { markdown: '| a |', html: '<table></table>' } });
    expect(entry).toEqual({ label: 'Copy table', action: { kind: 'copy-rich', text: '| a |', html: '<table></table>' } });
  });

  it('copies a link under the pointer', () => {
    expect(activityMenuEntries({ link: 'https://example.com' })[0])
      .toEqual({ label: 'Copy link', action: { kind: 'copy', text: 'https://example.com' } });
  });

  it('only offers Rewind for a user message with a checkpoint', () => {
    expect(labels(activityMenuEntries({ message: { kind: 'user', id: 'u', text: 'hi' } }))).toEqual(['Copy message']);
  });

  it('offers the full-width view only for document-like replies', () => {
    const short: ChatMessage = { kind: 'text', id: 'a', text: 'Done.', uuid: '' };
    const doc: ChatMessage = { kind: 'text', id: 'b', text: '## One\n\ntext\n\n## Two\n\ntext\n\n## Three\n\ntext', uuid: '' };
    expect(labels(activityMenuEntries({ message: short }))).toEqual(['Copy message']);
    const entries = activityMenuEntries({ message: doc });
    expect(labels(entries)).toEqual(['Copy message', 'Read full-width']);
    expect(entries[1].action).toEqual({ kind: 'focus', content: doc.text });
  });

  it('copies thinking, system and error text', () => {
    expect(activityMenuEntries({ message: { kind: 'thinking', id: 't', thinking: 'hmm' } })[0])
      .toEqual({ label: 'Copy thinking', action: { kind: 'copy', text: 'hmm' } });
    expect(labels(activityMenuEntries({ message: { kind: 'error', id: 'e', text: 'boom' } }))).toEqual(['Copy message']);
  });

  describe('tool calls', () => {
    it('copies a command and its output', () => {
      const entries = activityMenuEntries({ message: toolCall('Bash', { command: 'npm test' }, 'ok') });
      expect(entries.map((e) => [e.label, e.action])).toEqual([
        ['Copy command', { kind: 'copy', text: 'npm test' }],
        ['Copy output', { kind: 'copy', text: 'ok' }],
      ]);
    });

    it('copies the path of file tools and the pattern of searches', () => {
      expect(labels(activityMenuEntries({ message: toolCall('Edit', { file_path: 'a.ts' }) }))).toEqual(['Copy path']);
      expect(labels(activityMenuEntries({ message: toolCall('Read', { file_path: 'a.ts' }, 'line') })))
        .toEqual(['Copy path', 'Copy output']);
      expect(activityMenuEntries({ message: toolCall('Grep', { pattern: 'foo' }) })[0].action)
        .toEqual({ kind: 'copy', text: 'foo' });
    });

    it('copies other tools\' input as JSON, and skips an empty one', () => {
      expect(activityMenuEntries({ message: toolCall('WebFetch', { url: 'https://x.dev' }) })[0].action)
        .toEqual({ kind: 'copy', text: '{\n  "url": "https://x.dev"\n}' });
      expect(activityMenuEntries({ message: toolCall('TodoWrite', {}) })).toEqual([]);
    });

    it('leaves out a copy whose text is missing', () => {
      expect(activityMenuEntries({ message: toolCall('Bash', {}) })).toEqual([]);
    });
  });
});
