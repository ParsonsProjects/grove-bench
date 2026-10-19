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
    todoStore.toggle('b');
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

  it('toggles', () => {
    todoStore.toggle('a');
    expect(todoStore.has('a')).toBe(true);
    todoStore.toggle('a');
    expect(todoStore.has('a')).toBe(false);
  });

  it('forgets a deleted thread and keeps the rest', () => {
    todoStore.ids = ['a', 'b'];
    todoStore.forget('a');
    expect(saved()).toEqual(['b']);
  });
});
