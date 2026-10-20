import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamDeltas, STREAM_FLUSH_MS, isStreamDelta, type StreamDelta } from './session-stream.js';

const text = (t: string): StreamDelta => ({ type: 'partial_text', text: t });
const thinking = (t: string): StreamDelta => ({ type: 'partial_thinking', text: t });

describe('StreamDeltas', () => {
  let sent: StreamDelta[];
  let deltas: StreamDeltas;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    deltas = new StreamDeltas((e) => sent.push(e));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges consecutive deltas of a kind, in order, into one event sent on the timer', () => {
    deltas.add(text('Hel'));
    deltas.add(text('lo'));
    deltas.add(text(' world'));
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(STREAM_FLUSH_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([text('Hello world')]);
  });

  it('times the wait from the first delta held, so a steady stream still goes out', () => {
    deltas.add(text('a'));
    vi.advanceTimersByTime(20);
    deltas.add(text('b'));
    vi.advanceTimersByTime(STREAM_FLUSH_MS - 20);
    expect(sent).toEqual([text('ab')]);

    deltas.add(text('c'));
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(sent).toEqual([text('ab'), text('c')]);
  });

  it('sends the thinking held before text starts, so the kinds keep their order', () => {
    deltas.add(thinking('Let me '));
    deltas.add(thinking('think'));
    deltas.add(text('Answer'));
    expect(sent).toEqual([thinking('Let me think')]);

    deltas.add(text(': 42'));
    deltas.add(thinking('more'));
    expect(sent).toEqual([thinking('Let me think'), text('Answer: 42')]);

    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(sent).toEqual([thinking('Let me think'), text('Answer: 42'), thinking('more')]);
  });

  it('flush sends at once, and the timer then sends nothing more', () => {
    deltas.add(text('x'));
    deltas.add(text('y'));
    deltas.flush();
    expect(sent).toEqual([text('xy')]);

    vi.advanceTimersByTime(STREAM_FLUSH_MS * 3);
    deltas.flush();
    expect(sent).toEqual([text('xy')]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing when flushed with nothing held', () => {
    deltas.flush();
    expect(sent).toEqual([]);
  });

  it("doesn't change the events it is given", () => {
    const first = text('a');
    deltas.add(first);
    deltas.add(text('b'));
    deltas.flush();
    expect(first).toEqual(text('a'));
    expect(sent[0]).not.toBe(first);
  });

  it('neither loses nor repeats text, however the deltas and flushes fall', () => {
    // A fixed pseudo-random mix of kinds, flushes and waits.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const given: StreamDelta[] = [];
    for (let i = 0; i < 2_000; i++) {
      const delta = next() < 0.8 ? text(`t${i} `) : thinking(`h${i} `);
      given.push(delta);
      deltas.add(delta);
      const r = next();
      if (r < 0.05) deltas.flush();
      else if (r < 0.3) vi.advanceTimersByTime(Math.floor(next() * STREAM_FLUSH_MS * 2));
    }
    deltas.flush();

    // The same text, in the same order...
    expect(sent.map((e) => e.text).join('')).toBe(given.map((e) => e.text).join(''));
    // ...each event a run of one kind...
    for (const e of sent) {
      const marker = e.type === 'partial_text' ? 't' : 'h';
      expect(e.text.split(' ').filter(Boolean).every((w) => w.startsWith(marker))).toBe(true);
    }
    // ...and far fewer events than deltas.
    expect(sent.length).toBeLessThan(given.length / 2);
  });
});

describe('isStreamDelta', () => {
  it('is true for streamed text and thinking only', () => {
    expect(isStreamDelta(text('a'))).toBe(true);
    expect(isStreamDelta(thinking('a'))).toBe(true);
    expect(isStreamDelta({ type: 'assistant_text', text: 'a', uuid: 'u1' })).toBe(false);
    expect(isStreamDelta({ type: 'activity', activity: 'generating' })).toBe(false);
  });
});
