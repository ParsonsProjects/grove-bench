import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeRichText } from './clipboard.js';

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

function stubClipboard(write = vi.fn().mockResolvedValue(undefined)) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
  return { write, writeText };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeRichText', () => {
  it('writes plain text and HTML as one clipboard item', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write, writeText } = stubClipboard();

    await writeRichText('| a |', '<table></table>');

    expect(writeText).not.toHaveBeenCalled();
    const [[[item]]] = write.mock.calls as [[[FakeClipboardItem]]];
    expect(Object.keys(item.items)).toEqual(['text/plain', 'text/html']);
    expect(await item.items['text/plain'].text()).toBe('| a |');
    expect(await item.items['text/html'].text()).toBe('<table></table>');
  });

  it('falls back to plain text when ClipboardItem is missing', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const { write, writeText } = stubClipboard();

    await writeRichText('| a |', '<table></table>');

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('| a |');
  });

  it('falls back to plain text when the rich write is refused', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { writeText } = stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    await writeRichText('| a |', '<table></table>');

    expect(writeText).toHaveBeenCalledWith('| a |');
  });
});
