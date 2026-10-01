import { describe, it, expect, afterEach, vi } from 'vitest';
import { TurnEndWatcher, TURN_SETTLE_MS, flagsUnread } from './turn-end.js';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const ended: string[] = [];
  const watcher = new TurnEndWatcher((id) => ended.push(id));
  return { watcher, ended };
}

describe('TurnEndWatcher', () => {
  it('reports a turn once the conversation has stayed idle', () => {
    const { watcher, ended } = setup();
    watcher.update('s1', true);
    watcher.update('s1', false);
    vi.advanceTimersByTime(TURN_SETTLE_MS - 1);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended).toEqual(['s1']);
  });

  it('ignores a brief idle gap when the turn carries on', () => {
    const { watcher, ended } = setup();
    watcher.update('s1', true);
    watcher.update('s1', false);
    vi.advanceTimersByTime(TURN_SETTLE_MS / 2);
    watcher.update('s1', true);
    vi.advanceTimersByTime(TURN_SETTLE_MS * 2);
    expect(ended).toEqual([]);

    watcher.update('s1', false);
    vi.advanceTimersByTime(TURN_SETTLE_MS);
    expect(ended).toEqual(['s1']);
  });

  it('reports nothing for a conversation that was never running', () => {
    const { watcher, ended } = setup();
    watcher.update('s1', false);
    watcher.update('s1', false);
    vi.advanceTimersByTime(TURN_SETTLE_MS * 2);
    expect(ended).toEqual([]);
  });

  it('keeps conversations apart', () => {
    const { watcher, ended } = setup();
    watcher.update('s1', true);
    watcher.update('s2', true);
    watcher.update('s1', false);
    watcher.update('s2', false);
    watcher.update('s2', true);
    vi.advanceTimersByTime(TURN_SETTLE_MS);
    expect(ended).toEqual(['s1']);
  });
});

describe('flagsUnread', () => {
  it('flags a turn that finished in a conversation you are not looking at', () => {
    expect(flagsUnread({ id: 's1', status: 'running' }, 's2')).toBe(true);
    expect(flagsUnread({ id: 's1', status: 'running' }, null)).toBe(true);
  });

  it('does not flag the open conversation', () => {
    expect(flagsUnread({ id: 's1', status: 'running' }, 's1')).toBe(false);
  });

  it('does not flag a turn that ended because the conversation was stopped', () => {
    expect(flagsUnread({ id: 's1', status: 'stopped' }, null)).toBe(false);
  });
});
