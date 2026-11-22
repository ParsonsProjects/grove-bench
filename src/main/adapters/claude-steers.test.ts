import { describe, it, expect } from 'vitest';
import { SteerTracker } from './claude-steers.js';

type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;

const msg = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const assistant = (uuids?: string[]) => msg({ type: 'assistant', ...(uuids ? { user_message_uuid: uuids.at(-1), user_message_uuids: uuids } : {}) });
const result = msg({ type: 'result', subtype: 'success' });
const lifecycle = (uuid: string, state: string) => msg({ type: 'command_lifecycle', command_uuid: uuid, state });

describe('SteerTracker', () => {
  it('passes messages through when nothing is steered', () => {
    const t = new SteerTracker();
    expect(t.observe(result)).toEqual({ events: [], pass: [result] });
  });

  it('reports a steer read when a frame lists its uuid as consumed', () => {
    const t = new SteerTracker();
    t.add('s1');
    const frame = assistant(['p1', 's1']);

    expect(t.observe(frame)).toEqual({ events: [{ type: 'steer_read', uuid: 's1' }], pass: [frame] });
    expect(t.unread).toEqual([]);
  });

  it('takes a command_lifecycle "started" as read, and keeps the frame from the adapter', () => {
    const t = new SteerTracker();
    t.add('s1');

    expect(t.observe(lifecycle('s1', 'started'))).toEqual({ events: [{ type: 'steer_read', uuid: 's1' }], pass: [] });
  });

  it('holds a result while a steer is unread, and drops it once Claude starts answering the steer', () => {
    const t = new SteerTracker();
    t.add('s1');

    expect(t.observe(result)).toEqual({ events: [], pass: [] });
    expect(t.holding).toBe(true);

    // Claude runs the steer as the next turn: its first frame is stamped with it.
    const next = assistant(['s1']);
    expect(t.observe(next)).toEqual({ events: [{ type: 'steer_read', uuid: 's1' }], pass: [next] });
    expect(t.holding).toBe(false);

    const second = msg({ type: 'result', subtype: 'success', num_turns: 2 });
    expect(t.observe(second).pass).toEqual([expect.objectContaining({ type: 'result', subtype: 'success', num_turns: 2 })]);
  });

  it('lets the held result go when Claude drops the steer', () => {
    const t = new SteerTracker();
    t.add('s1');
    t.observe(result);

    expect(t.observe(lifecycle('s1', 'discarded'))).toEqual({
      events: [{ type: 'steer_dropped', uuid: 's1' }],
      pass: [result],
    });
  });

  it('holdOver() lets the held result go but keeps the steer pending, so a later read is still reported', () => {
    const t = new SteerTracker();
    t.add('s1');
    t.observe(result);

    // Claude Code still has the steer: reporting it dropped would resend it.
    expect(t.holdOver()).toEqual({ events: [], pass: [result] });
    expect(t.holding).toBe(false);
    expect(t.unread).toEqual(['s1']);

    const late = assistant(['s1']);
    expect(t.observe(late).events).toEqual([{ type: 'steer_read', uuid: 's1' }]);
  });

  it('release() at the end of the stream counts unread steers as dropped, and still reports a late read', () => {
    const t = new SteerTracker();
    t.add('s1');
    t.add('s2');
    t.observe(result);

    expect(t.release()).toEqual({
      events: [{ type: 'steer_dropped', uuid: 's1' }, { type: 'steer_dropped', uuid: 's2' }],
      pass: [result],
    });
    expect(t.holding).toBe(false);
    expect(t.observe(assistant(['s2'])).events).toEqual([{ type: 'steer_read', uuid: 's2' }]);
  });

  it('never holds a result that reports an error', () => {
    const t = new SteerTracker();
    t.add('s1');
    const failed = msg({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] });

    expect(t.observe(failed)).toEqual({ events: [], pass: [failed] });
    expect(t.holding).toBe(false);
  });

  it("adds a dropped held result's time and turns to the result that ends the turn", () => {
    const t = new SteerTracker();
    t.add('s1');
    t.observe(msg({ type: 'result', subtype: 'success', duration_ms: 4000, duration_api_ms: 3000, num_turns: 2 }));
    t.observe(assistant(['s1']));

    const [final] = t.observe(msg({ type: 'result', subtype: 'success', duration_ms: 1000, duration_api_ms: 500, num_turns: 1 })).pass;

    expect(final).toMatchObject({ duration_ms: 5000, duration_api_ms: 3500, num_turns: 3 });
  });

  it('ignores reads of uuids it never sent (the turn\'s own prompt)', () => {
    const t = new SteerTracker();
    t.add('s1');
    expect(t.observe(assistant(['p1'])).events).toEqual([]);
    expect(t.unread).toEqual(['s1']);
  });
});
