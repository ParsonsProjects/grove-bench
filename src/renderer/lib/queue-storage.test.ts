import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forgetQueue, loadQueues, saveQueue } from './queue-storage.js';
import type { QueuedMessage } from '../stores/messages.svelte.js';

const item = (id: string, text = id): QueuedMessage => ({ id, displayText: text, outgoing: text });

beforeEach(() => localStorage.clear());

describe('queue-storage', () => {
  it('saves each thread\'s queue and loads them all back', () => {
    saveQueue('a', [item('1'), item('2')]);
    saveQueue('b', [item('3')]);

    const queues = loadQueues();

    expect(queues.a.map((m) => m.id)).toEqual(['1', '2']);
    expect(queues.b.map((m) => m.id)).toEqual(['3']);
  });

  it('forgets a queue once it is empty, or with its thread', () => {
    saveQueue('a', [item('1')]);
    saveQueue('a', []);
    saveQueue('b', [item('2')]);
    forgetQueue('b');

    expect(loadQueues()).toEqual({});
  });

  it('keeps attachments once, and makes the images and files again on load', () => {
    const typed = { text: 'look', attachments: [
      { type: 'image' as const, name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' },
      { type: 'file' as const, name: 'b.pdf', dataUrl: 'data:application/pdf;base64,BBBB', mediaType: 'application/pdf', size: 3 },
    ] };
    const item: QueuedMessage = {
      id: '1', displayText: '[a.png, b.pdf] look', outgoing: 'look', typed,
      images: [{ data: 'AAAA', mediaType: 'image/png', name: 'a.png' }],
      files: [{ data: 'BBBB', mediaType: 'application/pdf', name: 'b.pdf' }],
    };
    saveQueue('a', [item]);

    expect(localStorage.getItem('grove-bench:queue:a')).not.toContain('"images"');
    expect(loadQueues().a).toEqual([item]);
  });

  it('removes the saved copy when a save fails, so a restart brings back nothing stale', () => {
    saveQueue('a', [item('1')]);
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('QuotaExceededError'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    saveQueue('a', [item('2')]);

    expect(loadQueues().a).toBeUndefined();
    warn.mockRestore();
  });

  it('skips damaged entries, other versions and items that are not messages', () => {
    localStorage.setItem('grove-bench:queue:bad', '{not json');
    localStorage.setItem('grove-bench:queue:old', JSON.stringify({ v: 0, items: [item('1')] }));
    localStorage.setItem('grove-bench:queue:mixed', JSON.stringify({ v: 1, items: [item('2'), { id: 3 }, null] }));
    localStorage.setItem('grove-bench:other', JSON.stringify({ v: 1, items: [item('4')] }));

    expect(loadQueues()).toEqual({ mixed: [item('2')] });
  });
});
