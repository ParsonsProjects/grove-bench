import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { todoStore } from './todo.svelte.js';

/** The flags as last saved through main. */
function saved() {
  const calls = mockGroveBench.setTodoSessions.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  todoStore.ids = [];
  todoStore.details = {};
  todoStore.alert = null;
  todoStore.ready = true;
});

afterEach(() => {
  todoStore.ids = [];
  todoStore.ready = false;
  mockGroveBench.getTodoSessions.mockReset();
  mockGroveBench.getTodoSessions.mockResolvedValue([]);
});

describe('todoStore.load', () => {
  beforeEach(() => {
    todoStore.ready = false;
  });

  it('reads the saved flags, ones for threads that did not load included', async () => {
    mockGroveBench.getTodoSessions.mockResolvedValue(['a', 'gone']);
    await todoStore.load(0);
    expect(todoStore.ready).toBe(true);
    expect(todoStore.has('a')).toBe(true);
    expect(todoStore.has('gone')).toBe(true);
  });

  it('asks again while the file can\'t be read', async () => {
    mockGroveBench.getTodoSessions.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('ipc')).mockResolvedValueOnce(['a']);
    await todoStore.load(0);
    expect(mockGroveBench.getTodoSessions).toHaveBeenCalledTimes(3);
    expect(todoStore.ids).toEqual(['a']);
    expect(todoStore.ready).toBe(true);
  });

  it('saves nothing while the saved flags are unknown, so they can\'t be written over', async () => {
    mockGroveBench.getTodoSessions.mockResolvedValue(null);
    await todoStore.load(0);
    expect(todoStore.ready).toBe(false);

    todoStore.set('a', true);
    expect(todoStore.has('a')).toBe(false);
    expect(mockGroveBench.setTodoSessions).not.toHaveBeenCalled();
  });
});

describe('todoStore', () => {
  it('flags and clears a thread, saving each change', () => {
    todoStore.set('a', true);
    todoStore.set('b', true);
    expect(saved()).toEqual(['a', 'b']);

    todoStore.set('a', false);
    expect(todoStore.has('a')).toBe(false);
    expect(todoStore.has('b')).toBe(true);
    expect(saved()).toEqual(['b']);
  });

  it('saves nothing when the flag is already as asked', () => {
    todoStore.set('a', false);
    todoStore.set('b', true);
    todoStore.set('b', true);
    expect(mockGroveBench.setTodoSessions).toHaveBeenCalledTimes(1);
    expect(todoStore.ids).toEqual(['b']);
  });

  it('forgets a deleted thread and keeps the rest', () => {
    todoStore.ids = ['a', 'b'];
    todoStore.forget('a');
    expect(saved()).toEqual(['b']);
  });
});

describe('todoStore notes and dates', () => {
  const NOON = new Date(2025, 10, 17, 12, 0).getTime();
  const min = 60_000;

  it('drops the note and date when the flag is cleared', () => {
    todoStore.set('a', true);
    todoStore.setDetails('a', { note: 'check by hand' });
    todoStore.set('a', false);
    expect(todoStore.getDetails('a')).toEqual({});
  });

  it('counts flagged threads whose date has come', () => {
    todoStore.ids = ['a', 'b', 'c'];
    todoStore.setDetails('a', { due: { at: NOON - min, timed: true } });
    todoStore.setDetails('b', { due: { at: NOON + min, timed: true } });
    todoStore.setDetails('gone', { due: { at: NOON - min, timed: false } });
    todoStore.tick(NOON);
    expect(todoStore.isDue('a')).toBe(true);
    expect(todoStore.isDue('b')).toBe(false);
    expect(todoStore.dueCount).toBe(1);
  });

  it('alerts once when a timed To do comes due', () => {
    todoStore.ids = ['a'];
    todoStore.setDetails('a', { note: 'look at the logs', due: { at: NOON, timed: true } });
    todoStore.tick(NOON - min);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();

    todoStore.tick(NOON + min);
    expect(todoStore.alert).toEqual({ sessionId: 'a', note: 'look at the logs' });
    expect(mockGroveBench.notify).toHaveBeenCalledTimes(1);

    todoStore.tick(NOON + 2 * min);
    expect(mockGroveBench.notify).toHaveBeenCalledTimes(1);
  });

  it('a missed alert only shows as due, with no late notification', () => {
    todoStore.ids = ['a'];
    todoStore.setDetails('a', { due: { at: NOON, timed: true } });
    todoStore.tick(NOON + 60 * min);
    expect(todoStore.alert).toBeNull();
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
    expect(todoStore.isDue('a')).toBe(true);
  });

  it('a date-only To do never alerts', () => {
    todoStore.ids = ['a'];
    todoStore.setDetails('a', { due: { at: NOON, timed: false } });
    todoStore.tick(NOON + min);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('a new date sets a new alert', () => {
    todoStore.ids = ['a'];
    todoStore.setDetails('a', { due: { at: NOON, timed: true } });
    todoStore.tick(NOON + min);
    todoStore.setDetails('a', { due: { at: NOON + 10 * min, timed: true } });
    todoStore.tick(NOON + 11 * min);
    expect(mockGroveBench.notify).toHaveBeenCalledTimes(2);
  });
});
