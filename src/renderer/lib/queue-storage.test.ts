import { describe, it, expect, beforeEach } from 'vitest';
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

  it('skips damaged entries, other versions and items that are not messages', () => {
    localStorage.setItem('grove-bench:queue:bad', '{not json');
    localStorage.setItem('grove-bench:queue:old', JSON.stringify({ v: 0, items: [item('1')] }));
    localStorage.setItem('grove-bench:queue:mixed', JSON.stringify({ v: 1, items: [item('2'), { id: 3 }, null] }));
    localStorage.setItem('grove-bench:other', JSON.stringify({ v: 1, items: [item('4')] }));

    expect(loadQueues()).toEqual({ mixed: [item('2')] });
  });
});
